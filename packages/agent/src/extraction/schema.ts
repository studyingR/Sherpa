import { z } from 'zod';
import { Purpose, Specialty } from '@sherpa/shared';

/** DebriefExtraction (docs/05 §5.1). The LLM fills this; code post-processes it. */
export const DebriefExtraction = z.object({
  summary: z.string(),
  purpose: Purpose,
  attendees: z.array(z.object({ name: z.string(), role: z.string(), external: z.boolean() })),
  clientNeeds: z.string(),
  riskSignals: z.string(),
  nextSteps: z.array(
    z.object({ title: z.string(), ownerName: z.string(), dueDateText: z.string(), clientCommitment: z.boolean() }),
  ),
  opportunities: z.array(z.object({ product: z.string(), amountText: z.string(), timingText: z.string() })),
  specialistInterest: z.array(Specialty),
  contactUpdates: z.array(z.object({ name: z.string(), title: z.string() })),
  noNextSteps: z.boolean(),
  missingFields: z.array(z.string()),
});
export type DebriefExtraction = z.infer<typeof DebriefExtraction>;

const str = { type: 'string' } as const;
const bool = { type: 'boolean' } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** Strict JSON schema for OpenAI structured outputs (every property required, no extras). */
export const DEBRIEF_EXTRACTION_JSON_SCHEMA = obj({
  summary: { type: 'string', description: '3-5 sentences, factual, third person, no speculation' },
  purpose: { type: 'string', enum: Purpose.options },
  attendees: { type: 'array', items: obj({ name: str, role: str, external: bool }) },
  clientNeeds: str,
  riskSignals: str,
  nextSteps: {
    type: 'array',
    items: obj({
      title: { type: 'string', description: 'Imperative, e.g. "Send equipment financing term sheet"' },
      ownerName: { type: 'string', description: '"RM" for the relationship manager, else a person or internal team name' },
      dueDateText: { type: 'string', description: "as spoken, e.g. 'by Friday'; empty if none" },
      clientCommitment: { type: 'boolean', description: 'true if the RM promised the client' },
    }),
  },
  opportunities: {
    type: 'array',
    items: obj({ product: str, amountText: { type: 'string', description: 'as spoken; empty if none' }, timingText: str }),
  },
  specialistInterest: { type: 'array', items: { type: 'string', enum: Specialty.options } },
  contactUpdates: { type: 'array', items: obj({ name: str, title: str }) },
  noNextSteps: { type: 'boolean', description: 'true only if the RM explicitly said there are no next steps' },
  missingFields: { type: 'array', items: str },
});

export const EMPTY_EXTRACTION: DebriefExtraction = {
  summary: '',
  purpose: 'OTHER',
  attendees: [],
  clientNeeds: '',
  riskSignals: '',
  nextSteps: [],
  opportunities: [],
  specialistInterest: [],
  contactUpdates: [],
  noNextSteps: false,
  missingFields: [],
};

/** Deal intake (docs/05 §5.2). */
export const DealExtraction = z.object({
  product: z.enum(['TERM_LOAN', 'LINE_OF_CREDIT', 'EQUIPMENT', 'CRE', 'SBA_7A', 'SBA_504', '']),
  amountText: z.string(),
  purpose: z.string(),
  termText: z.string(),
  amortizationText: z.string(),
  collateral: z.string(),
  requestedTiming: z.string(),
  useOfProceeds: z.string(),
  guarantors: z.array(z.string()),
  knownRisks: z.string(),
});
export type DealExtraction = z.infer<typeof DealExtraction>;

export const DEAL_EXTRACTION_JSON_SCHEMA = obj({
  product: { type: 'string', enum: ['TERM_LOAN', 'LINE_OF_CREDIT', 'EQUIPMENT', 'CRE', 'SBA_7A', 'SBA_504', ''] },
  amountText: str,
  purpose: str,
  termText: str,
  amortizationText: str,
  collateral: str,
  requestedTiming: str,
  useOfProceeds: str,
  guarantors: { type: 'array', items: str },
  knownRisks: str,
});

/** Global "Ask Sherpa" command parse (TaskCommand + routing). */
export const AskCommand = z.object({
  intent: z.enum([
    'BRIEF', 'DEBRIEF', 'AGENDA', 'TASK_COMPLETE', 'TASK_RESCHEDULE', 'TASK_DELEGATE', 'DRAFT_RECAP',
    'REFERRAL', 'NEW_DEAL', 'ALERTS', 'DOCUMENTS', 'COVERAGE', 'TALKING_POINTS', 'PRICING', 'HEALTH',
    'ACCOUNT_QUESTION', 'UNKNOWN',
  ]),
  accountText: z.string(),
  taskRef: z.string(),
  newDueDateText: z.string(),
  delegateToName: z.string(),
  specialty: z.string(),
  question: z.string(),
});
export type AskCommand = z.infer<typeof AskCommand>;

export const ASK_COMMAND_JSON_SCHEMA = obj({
  intent: { type: 'string', enum: AskCommand.shape.intent.options },
  accountText: str,
  taskRef: str,
  newDueDateText: str,
  delegateToName: str,
  specialty: str,
  question: str,
});
