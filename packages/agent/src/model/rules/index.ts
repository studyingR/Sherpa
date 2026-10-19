/** Deterministic model for mock mode: same contract as the LLM, no network, stable outputs for tests. */
import {
  SOURCE_LABEL,
  SPECIALTY_LABEL,
  firstName,
  formatLongDate,
  formatShortDate,
  type SourcedFact,
  type Specialty,
} from '@sherpa/shared';
import type { AskCommand, DealExtraction } from '../../extraction/schema';
import { SPECIALTY_KEYWORDS } from '../../extraction/context';
import { detectComplaint } from '../../guardrails/complaint';
import { detectMnpi } from '../../guardrails/mnpi';
import { detectSensitive } from '../../guardrails/sensitive';
import { splitSentences } from '../../guardrails/text';
import { findAmount } from '../../speech/numbers';
import type {
  AgentModel,
  AskContext,
  BriefSpeechInput,
  DocumentRequestInput,
  FlagClassification,
  HandoffInput,
  RecapInput,
  TalkingPointInput,
} from '../types';
import { extractDebriefByRules } from './debrief';

const MAX_BRIEF_WORDS = 220;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** "Send equipment financing term sheet" → "send the equipment financing term sheet" */
function withArticle(title: string): string {
  return lowerFirst(title).replace(/^(send|share|prepare|draft|review) (?!the |a |an |you|your|over )/i, '$1 the ');
}

function clientPhrase(step: RecapInput['nextSteps'][number]): string {
  const when = step.dueDate ? ` by ${formatLongDate(step.dueDate)}` : '';
  const intro = step.title.match(/^Introduce (?:the )?(.+?) specialist$/i);
  if (intro) return `I will introduce you to our ${intro[1]} specialist${when}.`;
  if (step.ownerType === 'TEAM') return `Our ${step.ownerName} team will reach out${when}.`;
  if (step.ownerType === 'USER') return `${firstName(step.ownerName)} from our team will follow up${when}.`;
  return `I will ${withArticle(step.title)}${when}.`;
}

const FACT_SYNONYMS: [RegExp, RegExp][] = [
  [/matur/i, /matur/i],
  [/utiliz|usage|drawn/i, /utiliz|outstanding/i],
  [/deposit|balance|cash/i, /deposit|balance/i],
  [/rating|risk grade|risk/i, /rating/i],
  [/covenant|dscr|leverage/i, /covenant|dscr|leverage/i],
  [/contact|cfo|ceo|owner|controller|who/i, /contact|cfo|owner|controller/i],
  [/last (?:touch|meeting|call)|when did (?:we|i)/i, /touch|activit/i],
  [/opportunit|pipeline|deal/i, /opportunit/i],
  [/news|press/i, /news/i],
  [/line|revolv|commitment|exposure|loan/i, /commitment|line|loan|exposure/i],
  [/profit|raroc|revenue/i, /raroc|revenue|profit/i],
  [/document|financials|statement|tickler/i, /document|financial|statement/i],
  [/promis|commitment|owe/i, /promis|commitment/i],
];

export class RuleModel implements AgentModel {
  readonly name = 'mock-rules';

  async extractDebrief(text: string, ctx: Parameters<AgentModel['extractDebrief']>[1]) {
    return extractDebriefByRules(text, ctx);
  }

  async classifyFlags(text: string): Promise<FlagClassification> {
    // The deterministic layer *is* the mock classifier; the orchestrator ORs it with patterns anyway.
    const c = detectComplaint(text);
    const m = detectMnpi(text);
    const s = detectSensitive(text);
    return {
      complaint: { flagged: c.flagged, summary: c.summary, evidence: c.evidence },
      mnpi: { flagged: m.flagged, evidence: m.evidence },
      sensitive: { flagged: s.flagged, categories: s.categories },
    };
  }

  async writeBriefSpoken(input: BriefSpeechInput): Promise<string> {
    const pick = (i: { text: string; privateText?: string }) => (input.privacy && i.privateText ? i.privateText : i.text);
    const head = `Here's your brief on ${input.accountName}${input.meetingLabel ? `, for ${input.meetingLabel}` : ''}.`;
    const groups: [string, { text: string; privateText?: string }[]][] = [
      ['What changed', input.changed],
      ['Coming due', input.due],
      ['What we promised', input.promised],
      ['Opportunities', input.opportunities],
      ['Risks', input.risks],
    ];
    const parts: string[] = [head];
    let budget = MAX_BRIEF_WORDS - words(head) - 12;
    for (const [label, items] of groups) {
      const chosen: string[] = [];
      for (const it of items.slice(0, 3)) {
        const t = pick(it).replace(/\.$/, '');
        if (words(t) + 2 > budget) break;
        chosen.push(t);
        budget -= words(t) + 1;
      }
      if (chosen.length) parts.push(`${label}: ${chosen.join('. ')}.`);
      budget -= 2;
    }
    if (input.missing.length) parts.push(`I couldn't reach ${input.missing.join(' or ')} right now.`);
    return parts.join(' ');
  }

  async answerFromFacts(question: string, facts: SourcedFact[]) {
    // Grounding: most of the question's content words must map to facts we have, else "I don't have that."
    const STOP = new Set(['what', 'when', 'where', 'which', 'who', 'does', 'did', 'is', 'are', 'was', 'the', 'their', 'they', 'them', 'our', 'we', 'for', 'about', 'how', 'much', 'many', 'with', 'this', 'that', 'have', 'has', 'any', 'and', 'of', 'to', 'in', 'on', 'a', 'an', 'do', 'its', 'it', 'current', 'right', 'now', 'tell', 'me']);
    const tokens = (question.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w));
    const hayAll = facts.map((f) => `${f.key} ${f.label}`.toLowerCase()).join(' ');
    const covered = tokens.filter((w) => FACT_SYNONYMS.some(([q, k]) => q.test(w) && k.test(hayAll)) || hayAll.includes(w) || hayAll.includes(w.slice(0, 5)));
    if (!tokens.length || covered.length / tokens.length < 0.6) return { answer: "I don't have that.", factKeys: [] };
    const scored = facts
      .map((f) => {
        let score = 0;
        const hay = `${f.key} ${f.label}`;
        for (const [q, k] of FACT_SYNONYMS) if (q.test(question) && k.test(hay)) score += 2;
        for (const w of tokens) if (hay.toLowerCase().includes(w.slice(0, 5))) score += 1;
        if (/\.item\d+$/.test(f.key)) score -= 1; // prefer sourced figures over list items
        return { f, score };
      })
      .filter((x) => x.score > 1)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return { answer: "I don't have that.", factKeys: [] };
    const top = scored.filter((x) => x.score === scored[0].score).slice(0, 3).map((x) => x.f);
    const answer = top
      .map((f) => `${f.label}: ${f.display} (${SOURCE_LABEL[f.source]}, as of ${formatShortDate(f.asOf)}).`)
      .join(' ');
    return { answer, factKeys: top.map((f) => f.key) };
  }

  async draftClientRecap(input: RecapInput) {
    const lines: string[] = [];
    lines.push(`Hi ${input.recipientFirstName},`, '');
    lines.push('Thank you for taking the time to meet with me today.', '');
    if (input.discussed.length) {
      lines.push('Here is a quick recap of what we discussed:');
      for (const d of input.discussed) lines.push(`- ${d}`);
      lines.push('');
    }
    if (input.nextSteps.length) {
      lines.push('Next steps:');
      for (const s of input.nextSteps) lines.push(`- ${clientPhrase(s)}`);
      lines.push('');
    }
    lines.push('Please let me know if I missed anything.', '', 'Best regards,', firstName(input.rmName));
    return { subject: `Following up on our ${input.purposeLabel.toLowerCase()}`, body: lines.join('\n') };
  }

  async draftInternalHandoff(input: HandoffInput) {
    const asks = input.asks.map((a) => `- ${a.title}${a.dueDate ? ` (by ${formatLongDate(a.dueDate)})` : ''}`);
    const body = [
      `Hi ${input.team} team,`,
      '',
      `I met with ${input.accountName} today. ${input.context}`.trim(),
      '',
      asks.length ? 'Could you please:' : 'Please follow up with the client on the item above.',
      ...asks,
      '',
      'Thanks,',
      firstName(input.rmName),
    ].join('\n');
    return { subject: `${input.accountName}: handoff to ${input.team}`, body };
  }

  async draftDocumentRequest(input: DocumentRequestInput) {
    const items = input.items.map(
      (i) => `- ${i.label}${i.period ? ` (${i.period})` : ''}, due ${formatLongDate(i.dueDate)}`,
    );
    const body = [
      `Hi ${input.recipientFirstName},`,
      '',
      input.reminder
        ? 'A friendly reminder that we are still waiting on the items below.'
        : 'I hope you are well. To keep your file up to date, could you send the following when you have a moment?',
      '',
      ...items,
      '',
      'You can reply to this email with the documents attached. Thank you.',
      '',
      'Best regards,',
      firstName(input.rmName),
    ].join('\n');
    return { subject: `${input.reminder ? 'Reminder: ' : ''}Documents for ${input.accountName}`, body };
  }

  async phraseTalkingPoint(input: TalkingPointInput) {
    const ev = input.evidence.map((e) => `${e.label.toLowerCase()} ${e.display}`).join(', ');
    const table: Record<string, { rationale: string; question: string }> = {
      TP_FX_NO_PRODUCT: { rationale: `International activity (${ev}) with no FX product in place.`, question: 'How are you paying overseas suppliers today, and does currency movement affect your margins?' },
      TP_POSPAY: { rationale: `Heavy wire and ACH activity (${ev}) without Positive Pay.`, question: 'What controls do you have today to catch fraudulent checks or payments?' },
      TP_SWEEP: { rationale: `High collected balances (${ev}) and no sweep account.`, question: 'Would it help to have excess balances work harder automatically overnight?' },
      TP_MERCHANT: { rationale: `${input.accountName} operates in a card-heavy industry and has no merchant services with us.`, question: 'How do you accept card payments today, and what does it cost you?' },
      TP_EQUIP: { rationale: `Recent capex or expansion signals (${ev}) and no equipment financing.`, question: 'What equipment purchases are you planning over the next year?' },
      TP_RENEWAL: { rationale: `A facility matures soon (${ev}).`, question: 'How are your borrowing needs changing ahead of the renewal?' },
    };
    return table[input.ruleId] ?? { rationale: `Based on ${ev}.`, question: 'What is changing in your business this year?' };
  }

  async extractDeal(text: string): Promise<DealExtraction> {
    const t = text.toLowerCase();
    const product: DealExtraction['product'] =
      /sba\s*504/.test(t) ? 'SBA_504'
      : /\bsba\b/.test(t) ? 'SBA_7A'
      : /equipment/.test(t) ? 'EQUIPMENT'
      : /real estate|\bcre\b|building|property/.test(t) ? 'CRE'
      : /line of credit|revolv|\bline\b/.test(t) ? 'LINE_OF_CREDIT'
      : /term loan/.test(t) ? 'TERM_LOAN'
      : '';
    const amount = findAmount(text);
    const term = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|twenty-five)[- ](year|month)s?\b(?! amortiz)/i);
    const amort = text.match(/amortiz\w*\s+over\s+(\d+|ten|fifteen|twenty|twenty-five|five|seven)\s+(year|month)s?/i)
      ?? text.match(/\b(\d+|ten|fifteen|twenty|twenty-five)[- ](year|month)s? amortiz/i);
    const collateral = text.match(/\b(?:secured by|collateral(?:ized)? (?:is|would be|will be|by)|backed by)\s+([^.,;]+)/i);
    const purpose = text.match(/\b(?:to|for)\s+((?:buy|purchase|finance|fund|refinance|expand|build|acquire|open)\b[^.,;]*)/i);
    const timing = text.match(/\b((?:close|fund|need it|needed|closing)\b[^.,;]*?(?:by|in|before)\s+[^.,;]+|by (?:the )?(?:end of (?:the )?(?:month|quarter|year)|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)[^.,;]*)/i);
    const guarantors: string[] = [];
    const g = text.match(/\b(?:guaranteed by|guarantors? (?:is|are|will be)|personal guarantee from)\s+([^.;]+)/i);
    if (g) guarantors.push(...g[1].split(/\s*(?:,|\band\b)\s*/).map((s) => s.trim()).filter(Boolean));
    const g2 = text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) will (?:personally )?guarantee/);
    if (g2 && !guarantors.includes(g2[1])) guarantors.push(g2[1]);
    const risks = splitSentences(text).filter((s) => /\b(risk|concern|worried|tight|decline|thin)\b/i.test(s));
    return {
      product,
      amountText: amount?.text ?? '',
      purpose: purpose?.[1]?.trim() ?? '',
      termText: term ? term[0] : '',
      amortizationText: amort ? amort[0] : '',
      collateral: collateral?.[1]?.trim() ?? '',
      requestedTiming: timing?.[1]?.trim() ?? '',
      useOfProceeds: purpose?.[1]?.trim() ?? '',
      guarantors,
      knownRisks: risks.join(' '),
    };
  }

  async parseAsk(text: string, ctx: AskContext): Promise<AskCommand> {
    const t = text.trim();
    const lower = t.toLowerCase();
    const account = ctx.accountNames.find((n) => lower.includes(n.toLowerCase()))
      ?? ctx.accountNames.find((n) => lower.includes(n.toLowerCase().split(' ')[0]))
      ?? '';
    const base: AskCommand = { intent: 'UNKNOWN', accountText: account, taskRef: '', newDueDateText: '', delegateToName: '', specialty: '', question: t };
    let m: RegExpMatchArray | null;
    if (/\b(debrief)\b/i.test(t)) return { ...base, intent: 'DEBRIEF' };
    if ((m = t.match(/\bmark (?:the )?(.+?) (?:as )?(?:done|complete|completed|finished)\b/i))) return { ...base, intent: 'TASK_COMPLETE', taskRef: m[1] };
    if ((m = t.match(/\b(?:push|move|reschedule|bump)\s+(?:the\s+)?(.+?)\s+(?:to|until|out to)\s+(.+)$/i))) return { ...base, intent: 'TASK_RESCHEDULE', taskRef: m[1], newDueDateText: m[2] };
    if ((m = t.match(/\b(?:delegate|hand off|assign)\s+(?:the\s+)?(.+?)\s+to\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i))) return { ...base, intent: 'TASK_DELEGATE', taskRef: m[1], delegateToName: m[2] };
    if (/\b(recap|follow[- ]?up email|draft (?:the |an )?email)\b/i.test(t)) return { ...base, intent: 'DRAFT_RECAP' };
    if ((m = t.match(/\brefer(?:ral)?\b.*?\bto\s+(fx|treasury|wealth|sba|capital markets|equipment(?: finance)?|merchant(?: services)?)/i))) return { ...base, intent: 'REFERRAL', specialty: m[1] };
    if (/\brefer(?:ral)?\b/i.test(t)) return { ...base, intent: 'REFERRAL' };
    if (/\b(new deal|deal intake|credit request|new loan)\b/i.test(t)) return { ...base, intent: 'NEW_DEAL' };
    if (/\b(pricing|spread|what rate)\b/i.test(t)) return { ...base, intent: 'PRICING' };
    if (/\b(health score|relationship health|at risk|attrition)\b/i.test(t)) return { ...base, intent: 'HEALTH' };
    if (/\b(agenda|my day|today|what's next|what is next|schedule)\b/i.test(t) && !account) return { ...base, intent: 'AGENDA' };
    if (/\b(alerts?|watch ?list)\b/i.test(t)) return { ...base, intent: 'ALERTS' };
    if (/\b(documents?|docs|financials due|tickler)\b/i.test(t)) return { ...base, intent: 'DOCUMENTS' };
    if (/\b(coverage|who should i call|haven't (?:talked|spoken)|outreach|weekly plan)\b/i.test(t)) return { ...base, intent: 'COVERAGE' };
    if (/\b(talking points?|what should i (?:bring up|discuss|talk about))\b/i.test(t)) return { ...base, intent: 'TALKING_POINTS' };
    if (/\b(brief me|brief on|prep me|prepare me|get me ready)\b/i.test(t)) return { ...base, intent: 'BRIEF' };
    if (account) return { ...base, intent: 'ACCOUNT_QUESTION' };
    return base;
  }

  async summarizeNeed(text: string, specialty: Specialty, accountName: string) {
    const kw = SPECIALTY_KEYWORDS.find((k) => k.specialty === specialty)?.re;
    const hits = splitSentences(text).filter((s) => kw?.test(s));
    if (hits.length) return hits.slice(0, 2).join(' ');
    return `${accountName} expressed interest in ${SPECIALTY_LABEL[specialty]}.`;
  }
}
