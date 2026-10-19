/**
 * Rule-based debrief extractor used by the mock model (docs/05 §2: "falls back to a simple rule-based
 * extractor"). Produces the same DebriefExtraction shape as the LLM so post-processing is shared.
 */
import { firstName, type Purpose, type Specialty } from '@sherpa/shared';
import { EMPTY_EXTRACTION, type DebriefExtraction } from '../../extraction/schema';
import { SPECIALTY_KEYWORDS, matchPerson, matchTeam, type DebriefContext } from '../../extraction/context';
import { detectSensitive } from '../../guardrails/sensitive';
import { splitClauses, splitSentences } from '../../guardrails/text';
import { splitDatePhrase } from '../../speech/dates';
import { findAmount } from '../../speech/numbers';

export const PRODUCTS: { product: string; re: RegExp }[] = [
  { product: 'Equipment financing', re: /\bequipment (?:financ\w*|loan|lease)\b/i },
  { product: 'SBA loan', re: /\bsba\b(?: 7\s?\(?a\)?| 504)?(?: loan)?/i },
  { product: 'Line of credit', re: /\b(line of credit|new line|credit line|revolv\w+(?: line)?|revolver|working capital line)\b/i },
  { product: 'Term loan', re: /\bterm loan\b/i },
  { product: 'Commercial real estate loan', re: /\b(real estate loan|cre loan|commercial mortgage|building purchase|buy (?:the|a) building)\b/i },
  { product: 'Treasury management', re: /\b(treasury management|cash management) (?:package|services|deal|opportunity)\b/i },
];

const FILLER = /^(good|great|nice|solid|productive|quick|fine|ok(?:ay)?)\s+(meeting|call|chat|visit|check-?in)\.?$/i;
const NO_NEXT_STEPS = /\b(no next steps|nothing to follow up(?: on)?|no follow[- ]?ups?|no action items|nothing else to do)\b/i;
const CLIENT_PRONOUN = /^(they|he|she|it|the client|their|them)\b/i;

interface StepCandidate {
  title: string;
  ownerName: string;
  dueDateText: string;
  clientCommitment: boolean;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanTitle(s: string): string {
  return capitalize(
    s
      .replace(/^(?:to|that i'?d|i'?d|also|then|please)\s+/i, '')
      .replace(/\s+(?:for them|for her|for him)$/i, '')
      .replace(/[.,;:!?]+$/, '')
      .trim(),
  );
}

/** Parses one clause into a next step, or null. Owner "RM" means the signed-in RM. */
export function parseStepClause(clause: string, ctx: DebriefContext): StepCandidate | null {
  const c = clause.replace(/^(?:and|also|then|plus)\s+/i, '').trim();
  let m: RegExpMatchArray | null;

  // 1. RM promise to the client: "I said I'd send a term sheet by Friday"
  if ((m = c.match(/^i\s+(?:said|told (?:them|her|him|\w+)|promised(?: them| her| him)?|committed|agreed)\s+(?:that\s+)?(?:i(?:'d| would| will|'ll)|to)\s+(.+)$/i))) {
    const { rest, dateText } = splitDatePhrase(m[1]);
    return { title: cleanTitle(rest), ownerName: 'RM', dueDateText: dateText, clientCommitment: true };
  }
  // 2. RM action: "I'll ..." / "I need to ..."
  if ((m = c.match(/^i(?:'ll| will| need to| have to| should|'m going to| am going to| want to)\s+(.+)$/i))) {
    if (/^(think|guess|bet|say)\b/i.test(m[1])) return null;
    const { rest, dateText } = splitDatePhrase(m[1]);
    return { title: cleanTitle(rest), ownerName: 'RM', dueDateText: dateText, clientCommitment: false };
  }
  // 3. "We'll ..." / "we promised to ..."
  if ((m = c.match(/^we(?:'ll| will| need to| should| promised to| agreed to|'re going to)\s+(.+)$/i))) {
    const { rest, dateText } = splitDatePhrase(m[1]);
    return { title: cleanTitle(rest), ownerName: 'RM', dueDateText: dateText, clientCommitment: /promised|agreed/i.test(c) };
  }
  // 4. "Let's ..." / "need to ..." / "to do: ..."
  if ((m = c.match(/^(?:let'?s|need to|to do:?|action item:?)\s+(.+)$/i))) {
    const { rest, dateText } = splitDatePhrase(m[1]);
    return { title: cleanTitle(rest), ownerName: 'RM', dueDateText: dateText, clientCommitment: false };
  }
  // 5. "<Team or person> should/will call Jane by Wednesday"
  if ((m = c.match(/^(.{2,40}?)\s+(?:should|will|needs to|is going to|has to|can|to)\s+(.+)$/i))) {
    const subject = m[1].trim();
    if (!CLIENT_PRONOUN.test(subject) && !/^(i|we|you)$/i.test(subject)) {
      const team = matchTeam(subject);
      const user = team ? null : matchPerson(subject, ctx.users);
      const contact = team || user ? null : matchPerson(subject, ctx.contacts);
      if (team || user) {
        const { rest, dateText } = splitDatePhrase(m[2]);
        return { title: cleanTitle(rest), ownerName: team ?? user!.name, dueDateText: dateText, clientCommitment: false };
      }
      if (contact) {
        const { rest, dateText } = splitDatePhrase(m[2]);
        return { title: `Follow up with ${firstName(contact.name)} on ${rest.replace(/[.]+$/, '')}`, ownerName: 'RM', dueDateText: dateText, clientCommitment: false };
      }
    }
  }
  // 6. Imperatives: "loop in Tom", "send the deck", "schedule a site visit"
  if ((m = c.match(/^(?:please\s+)?((?:loop in|send|schedule|set up|call|email|introduce|follow up(?: with| on)?|book|get|prepare|draft|review|reach out to|connect)\b.*)$/i))) {
    const { rest, dateText } = splitDatePhrase(m[1]);
    return { title: cleanTitle(rest), ownerName: 'RM', dueDateText: dateText, clientCommitment: false };
  }
  return null;
}

function inferPurpose(subject: string | null, text: string): Purpose | null {
  const s = `${subject ?? ''} ${text}`.toLowerCase();
  if (/annual review/.test(s)) return 'ANNUAL_REVIEW';
  if (/renewal|renew\b/.test(s)) return 'RENEWAL';
  if (/treasury review|treasury management review/.test(s)) return 'TREASURY_REVIEW';
  if (/new (?:credit|loan|deal|line)|credit request/.test(s)) return 'NEW_CREDIT';
  if (/check-?in|catch[- ]up/.test(s)) return 'CHECK_IN';
  if (/issue|problem|resolve|resolution|complain/.test(subject ?? '')) return 'ISSUE_RESOLUTION';
  if (/financials? discussion|site visit|intro/.test(s)) return 'OTHER';
  return null;
}

/** Third-person rewrite for the summary ("I said I'd" → "Maya committed to"). */
function toThirdPerson(sentence: string, ctx: DebriefContext, state: { namedAccount: boolean }): string {
  const rm = firstName(ctx.rm.name);
  let s = sentence
    .replace(/^I said I'?d\b/i, `${rm} committed to`)
    .replace(/^I told (?:them|her|him) I'?d\b/i, `${rm} committed to`)
    .replace(/^I promised(?: them| her| him)? (?:to|I'?d)\b/i, `${rm} committed to`)
    .replace(/\bI'll\b/g, `${rm} will`)
    .replace(/\bI'd\b/g, `${rm} would`)
    .replace(/\bI\b/g, rm);
  if (/^They(?:'re| are)\b/.test(s)) {
    s = s.replace(/^They(?:'re| are)\b/, state.namedAccount ? 'The company is' : `${ctx.accountName} is`);
    state.namedAccount = true;
    s = s.replace(/\band (need|want|plan|expect)\b/g, 'and $1s');
  } else if (/^They\b/.test(s)) {
    s = s.replace(/^They\b/, state.namedAccount ? 'The company' : ctx.accountName);
    state.namedAccount = true;
    // Subject is now singular: "They need" → "Acme Manufacturing needs".
    const SING: Record<string, string> = { need: 'needs', want: 'wants', plan: 'plans', expect: 'expects', have: 'has', are: 'is', were: 'was', do: 'does' };
    s = s.replace(/^((?:The company|[^ ]+(?: [A-Z][^ ]*)*)) (need|want|plan|expect|have|are|were|do)\b/, (_m, subj: string, verb: string) => `${subj} ${SING[verb]}`);
  }
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

export function extractDebriefByRules(text: string, ctx: DebriefContext): DebriefExtraction {
  const out: DebriefExtraction = structuredClone(EMPTY_EXTRACTION);
  const sentences = splitSentences(text);
  const sensitive = detectSensitive(text);
  const sensitiveSet = new Set(sensitive.sentences);

  // Next steps (clauses), opportunities (sentences)
  for (const sentence of sentences) {
    for (const clause of splitClauses(sentence)) {
      const step = parseStepClause(clause, ctx);
      if (step && step.title.length > 2) out.nextSteps.push(step);
    }
    // Two products in one sentence ("a $2M line ... and a $1.2M term loan") are split into separate clauses.
    const productHits = PRODUCTS.filter((p) => p.re.test(sentence)).length;
    const oppClauses = productHits > 1 ? sentence.split(/\s+and\s+(?=(?:a|an|another)\s)/i) : [sentence];
    for (const clause of oppClauses) {
      const product = PRODUCTS.find((p) => p.re.test(clause));
      const amount = findAmount(clause);
      if (product || (amount && /\b(loan|financ\w*|credit|line|borrow)\b/i.test(clause))) {
        const name = product?.product ?? 'Loan';
        if (!out.opportunities.some((o) => o.product === name)) {
          out.opportunities.push({ product: name, amountText: amount?.text ?? '', timingText: clause });
        }
      }
    }
  }

  // "Term sheet" next to a product opportunity gets the product name: "Send equipment financing term sheet".
  if (out.opportunities.length) {
    const p = out.opportunities[0].product.toLowerCase();
    out.nextSteps = out.nextSteps.map((s) => ({
      ...s,
      title: s.title.replace(/^(Send|Prepare|Draft) (?:a |the |them a )?term sheet$/i, `$1 ${p} term sheet`),
    }));
  }

  out.noNextSteps = NO_NEXT_STEPS.test(text);

  const specialties = new Set<Specialty>();
  for (const k of SPECIALTY_KEYWORDS) if (k.re.test(text)) specialties.add(k.specialty);
  out.specialistInterest = [...specialties];

  const needs = sentences.filter(
    (s) => !sensitiveSet.has(s) && /\b(needs?|wants?|looking for|asked about|interested in|considering|plans? to|planning to|expanding|would like)\b/i.test(s) && !/^i\s/i.test(s),
  );
  out.clientNeeds = needs.join(' ');

  const risks = sentences.filter(
    (s) =>
      /\b(concern\w*|worried|struggl\w*|declin\w*|lost (?:a|their) (?:major |big )?customer|behind on|late pay\w*|cash ?flow (?:issue|problem|is tight)|margin pressure|layoffs?|slow(?:er)? sales|downturn|covenant)\b/i.test(s),
  );
  out.riskSignals = risks.join(' ');

  // Contact updates: "Ana is the new CFO", "the new controller is Raj Mehta"
  for (const s of sentences) {
    let m = s.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:is|was named|was promoted to|has become|became) (?:the |their )?(?:new )?(CFO|CEO|COO|Controller|Treasurer|President|Owner|Managing Partner|VP of [A-Z][a-z]+)\b/);
    if (m) out.contactUpdates.push({ name: m[1], title: m[2] });
    m = s.match(/\b(?:the |their )?new (CFO|CEO|COO|controller|treasurer|president) is ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/i);
    if (m) out.contactUpdates.push({ name: m[2], title: m[1].length <= 3 ? m[1].toUpperCase() : capitalize(m[1]) });
  }

  // Summary: factual, third person, sensitive sentences left out (C-05).
  const state = { namedAccount: false };
  const summarySentences = sentences
    .filter((s) => !FILLER.test(s) && !sensitiveSet.has(s) && !NO_NEXT_STEPS.test(s) && s.split(' ').length > 2)
    .slice(0, 5)
    .map((s) => toThirdPerson(s, ctx, state));
  out.summary = summarySentences.join(' ');

  out.purpose = inferPurpose(ctx.meetingSubject, text) ?? 'OTHER';
  if (!inferPurpose(ctx.meetingSubject, text)) out.missingFields.push('purpose');

  out.attendees = ctx.attendees.map((a) => ({ name: a.name, role: a.role ?? '', external: a.external }));
  return out;
}

/** Gap answers are short and targeted: parse them in the context of the question asked. */
export function parseOwnerDateAnswer(text: string, ctx: DebriefContext): { ownerName: string | null; dueDateText: string } {
  const team = matchTeam(text);
  const user = team ? null : ctx.users.find((u) => new RegExp(`\\b${firstName(u.name)}\\b`, 'i').test(text));
  const me = /\b(i|me|myself|i'll|i will)\b/i.test(text);
  const { dateText } = splitDatePhrase(text);
  return { ownerName: team ?? user?.name ?? (me ? 'RM' : null), dueDateText: dateText };
}

/** Map whatever the model called a product to Sherpa's canonical product names. */
export function canonicalProduct(name: string): string {
  const hit = PRODUCTS.find((p) => p.re.test(name));
  if (hit) return hit.product;
  if (/\bsba\b/i.test(name)) return 'SBA loan';
  if (/\bline\b/i.test(name)) return 'Line of credit';
  if (/\bequipment\b/i.test(name)) return 'Equipment financing';
  if (/\bterm\b/i.test(name)) return 'Term loan';
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
