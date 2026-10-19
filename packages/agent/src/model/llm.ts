/**
 * LLM-backed model (openai mode). Structured outputs are validated with zod; invalid output gets one
 * repair retry, then the deterministic RuleModel answers instead (docs/05 §1). PII is scrubbed first (C-13).
 */
import { z } from 'zod';
import type { LlmMessage, LlmProvider } from '@sherpa/adapters';
import type { SourcedFact, Specialty } from '@sherpa/shared';
import {
  ASK_COMMAND_JSON_SCHEMA,
  AskCommand,
  DEAL_EXTRACTION_JSON_SCHEMA,
  DEBRIEF_EXTRACTION_JSON_SCHEMA,
  DealExtraction,
  DebriefExtraction,
} from '../extraction/schema';
import type { DebriefContext } from '../extraction/context';
import { scrubPii } from '../guardrails/pii';
import { wrapAsData } from '../guardrails/injection';
import * as P from '../prompts';
import { RuleModel } from './rules';
import type {
  AgentModel,
  AskContext,
  BriefSpeechInput,
  DocumentRequestInput,
  FlagClassification,
  HandoffInput,
  RecapInput,
  TalkingPointInput,
} from './types';

export interface ModelLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

const FlagSchema = z.object({
  complaint: z.object({ flagged: z.boolean(), summary: z.string(), evidence: z.string() }),
  mnpi: z.object({ flagged: z.boolean(), evidence: z.string() }),
  sensitive: z.object({ flagged: z.boolean(), categories: z.array(z.string()) }),
});
const FLAG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['complaint', 'mnpi', 'sensitive'],
  properties: {
    complaint: { type: 'object', additionalProperties: false, required: ['flagged', 'summary', 'evidence'], properties: { flagged: { type: 'boolean' }, summary: { type: 'string' }, evidence: { type: 'string' } } },
    mnpi: { type: 'object', additionalProperties: false, required: ['flagged', 'evidence'], properties: { flagged: { type: 'boolean' }, evidence: { type: 'string' } } },
    sensitive: { type: 'object', additionalProperties: false, required: ['flagged', 'categories'], properties: { flagged: { type: 'boolean' }, categories: { type: 'array', items: { type: 'string' } } } },
  },
};

const AnswerSchema = z.object({ answer: z.string(), factKeys: z.array(z.string()) });
const ANSWER_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'factKeys'],
  properties: { answer: { type: 'string' }, factKeys: { type: 'array', items: { type: 'string' } } },
};
const EmailSchema = z.object({ subject: z.string(), body: z.string() });
const EMAIL_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['subject', 'body'],
  properties: { subject: { type: 'string' }, body: { type: 'string' } },
};
const TalkingSchema = z.object({ rationale: z.string(), question: z.string() });
const TALKING_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rationale', 'question'],
  properties: { rationale: { type: 'string' }, question: { type: 'string' } },
};

export class LlmModel implements AgentModel {
  readonly name: string;
  private rules = new RuleModel();

  constructor(private llm: LlmProvider, private log?: ModelLogger) {
    this.name = llm.model;
  }

  private async structured<T>(task: string, system: string, user: string, schema: z.ZodType<T>, jsonSchema: Record<string, unknown>, temperature = 0): Promise<T> {
    const scrub = scrubPii(user);
    const messages: LlmMessage[] = [
      { role: 'system', content: `${P.BASE_SYSTEM}\n\n${system}` },
      { role: 'user', content: scrub.text },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.llm.complete({ messages, temperature, json: { name: task, schema: jsonSchema } });
      this.log?.info({ task, latencyMs: res.latencyMs, usage: res.usage, attempt, piiTokens: scrub.tokens }, 'llm call');
      try {
        const parsed = schema.parse(JSON.parse(scrub.restore(res.text)));
        return parsed;
      } catch (err) {
        this.log?.warn({ task, attempt, err: String(err) }, 'llm output invalid; repairing');
        messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: 'That did not match the schema. Return only valid JSON for the schema.' });
      }
    }
    throw new Error(`LLM output invalid for ${task}`);
  }

  private async text(task: string, system: string, user: string, temperature = 0.2): Promise<string> {
    const scrub = scrubPii(user);
    const res = await this.llm.complete({
      messages: [
        { role: 'system', content: `${P.BASE_SYSTEM}\n\n${system}` },
        { role: 'user', content: scrub.text },
      ],
      temperature,
    });
    this.log?.info({ task, latencyMs: res.latencyMs, usage: res.usage }, 'llm call');
    return scrub.restore(res.text).trim();
  }

  private async withFallback<T>(task: string, fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.log?.warn({ task, err: String(err) }, 'llm failed; using rules');
      return fallback();
    }
  }

  extractDebrief(text: string, ctx: DebriefContext) {
    const user = [
      `Account: ${ctx.accountName}. RM: ${ctx.rm.name}. Meeting: ${ctx.meetingSubject ?? 'unknown'} on ${ctx.meetingDate.toDateString()}.`,
      `Attendees: ${ctx.attendees.map((a) => `${a.name}${a.role ? ` (${a.role})` : ''}${a.external ? '' : ' [bank]'}`).join(', ')}.`,
      `Internal colleagues: ${ctx.users.map((u) => u.name).join(', ')}.`,
      'RM said:',
      text,
    ].join('\n');
    return this.withFallback('extractDebrief', () => this.structured('DebriefExtraction', P.DEBRIEF_EXTRACT, user, DebriefExtraction, DEBRIEF_EXTRACTION_JSON_SCHEMA), () => this.rules.extractDebrief(text, ctx));
  }

  classifyFlags(text: string): Promise<FlagClassification> {
    return this.withFallback('classifyFlags', () => this.structured('FlagClassification', P.FLAG_CLASSIFIER, text, FlagSchema, FLAG_JSON_SCHEMA), () => this.rules.classifyFlags(text));
  }

  writeBriefSpoken(input: BriefSpeechInput) {
    const pick = (i: { text: string; privateText?: string }) => (input.privacy && i.privateText ? i.privateText : i.text);
    const list = (label: string, items: { text: string; privateText?: string }[]) => `${label}:\n${items.map((i) => `- ${pick(i)}`).join('\n') || '- none'}`;
    const user = [
      `Account: ${input.accountName}${input.meetingLabel ? `; meeting ${input.meetingLabel}` : ''}. Privacy mode: ${input.privacy ? 'on' : 'off'}.`,
      list('What changed', input.changed),
      list('Coming due', input.due),
      list('What we promised', input.promised),
      list('Opportunities', input.opportunities),
      list('Risks', input.risks),
      input.missing.length ? `Unavailable sources: ${input.missing.join(', ')}. Mention this briefly.` : '',
    ].join('\n\n');
    return this.withFallback('writeBriefSpoken', async () => {
      const out = await this.text('brief', P.BRIEF_SPOKEN, user);
      const w = out.split(/\s+/);
      return w.length > 225 ? `${w.slice(0, 220).join(' ').replace(/[,;:]$/, '')}.` : out;
    }, () => this.rules.writeBriefSpoken(input));
  }

  answerFromFacts(question: string, facts: SourcedFact[]) {
    const user = `Facts:\n${facts.map((f) => `[${f.key}] ${f.label}: ${f.display} (source ${f.source}, as of ${f.asOf.slice(0, 10)})`).join('\n')}\n\nQuestion: ${question}`;
    return this.withFallback('answerFromFacts', async () => {
      const r = await this.structured('BriefAnswer', P.BRIEF_QA, user, AnswerSchema, ANSWER_JSON_SCHEMA);
      const keys = r.factKeys.filter((k) => facts.some((f) => f.key === k));
      // Grounding check: an answer that cites no provided fact is replaced with the honest default.
      return keys.length ? { answer: r.answer, factKeys: keys } : { answer: "I don't have that.", factKeys: [] };
    }, () => this.rules.answerFromFacts(question, facts));
  }

  draftClientRecap(input: RecapInput) {
    const user = `RM: ${input.rmName}. Client: ${input.recipientFirstName} at ${input.accountName}. Meeting: ${input.purposeLabel}.
Discussed (client-raised): ${input.discussed.join('; ') || 'none'}
Next steps (RM included): ${input.nextSteps.map((s) => `${s.title} — owner ${s.ownerType === 'RM' ? 'me' : s.ownerName}${s.dueDate ? ` by ${s.dueDate}` : ''}`).join('; ') || 'none'}`;
    return this.withFallback('draftClientRecap', () => this.structured('ClientRecap', P.FOLLOW_UP_CLIENT, user, EmailSchema, EMAIL_JSON_SCHEMA, 0.3), () => this.rules.draftClientRecap(input));
  }

  draftInternalHandoff(input: HandoffInput) {
    const user = `From ${input.rmName} to ${input.team} about ${input.accountName}.\nContext: ${input.context}\nAsks: ${input.asks.map((a) => `${a.title}${a.dueDate ? ` by ${a.dueDate}` : ''}`).join('; ')}`;
    return this.withFallback('draftInternalHandoff', () => this.structured('InternalHandoff', P.FOLLOW_UP_INTERNAL, user, EmailSchema, EMAIL_JSON_SCHEMA, 0.2), () => this.rules.draftInternalHandoff(input));
  }

  draftDocumentRequest(input: DocumentRequestInput) {
    // Document requests are templated: wording carries regulatory weight and must stay consistent.
    return this.rules.draftDocumentRequest(input);
  }

  phraseTalkingPoint(input: TalkingPointInput) {
    const user = `Account: ${input.accountName}. Rule ${input.ruleId}: ${input.title}.\nEvidence:\n${input.evidence.map((e) => `- ${e.label}: ${e.display} (${e.source})`).join('\n')}`;
    return this.withFallback('phraseTalkingPoint', () => this.structured('TalkingPoint', P.TALKING_POINT, user, TalkingSchema, TALKING_JSON_SCHEMA, 0.3), () => this.rules.phraseTalkingPoint(input));
  }

  extractDeal(text: string) {
    return this.withFallback('extractDeal', () => this.structured('DealExtraction', P.DEAL_EXTRACT, text, DealExtraction, DEAL_EXTRACTION_JSON_SCHEMA), () => this.rules.extractDeal(text));
  }

  async parseAsk(text: string, ctx: AskContext) {
    // Deterministic routing first; the LLM only resolves what the rules cannot.
    const ruled = await this.rules.parseAsk(text, ctx);
    if (ruled.intent !== 'UNKNOWN') return ruled;
    const user = `Accounts in the RM's book: ${ctx.accountNames.join('; ')}\nRequest: ${text}`;
    return this.withFallback('parseAsk', () => this.structured('AskCommand', P.ASK_ROUTER, user, AskCommand, ASK_COMMAND_JSON_SCHEMA), async () => ruled);
  }

  summarizeNeed(text: string, specialty: Specialty, accountName: string) {
    return this.withFallback('summarizeNeed', () => this.text('referralNeed', P.REFERRAL_NEED, `${accountName}, specialty ${specialty}.\n${wrapAsData('debrief', text)}`), () => this.rules.summarizeNeed(text, specialty, accountName));
  }
}
