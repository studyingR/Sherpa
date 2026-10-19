import type { SourcedFact, Specialty } from '@sherpa/shared';
import type { DebriefContext } from '../extraction/context';
import type { AskCommand, DealExtraction, DebriefExtraction } from '../extraction/schema';

export interface FlagClassification {
  complaint: { flagged: boolean; summary?: string; evidence?: string };
  mnpi: { flagged: boolean; evidence?: string };
  sensitive: { flagged: boolean; categories: string[] };
}

export interface SpeechItem {
  /** Spoken text including figures. */
  text: string;
  /** Same item with balances/exposure replaced, used when privacy mode is on (C-09). */
  privateText?: string;
}

export interface BriefSpeechInput {
  accountName: string;
  meetingLabel: string | null;
  changed: SpeechItem[];
  due: SpeechItem[];
  promised: SpeechItem[];
  opportunities: SpeechItem[];
  risks: SpeechItem[];
  missing: string[];
  privacy: boolean;
}

export interface RecapInput {
  rmName: string;
  accountName: string;
  recipientFirstName: string;
  purposeLabel: string;
  discussed: string[];
  nextSteps: { title: string; ownerType: 'RM' | 'USER' | 'TEAM'; ownerName: string; dueDate: string | null }[];
}

export interface HandoffInput {
  rmName: string;
  accountName: string;
  team: string;
  context: string;
  asks: { title: string; dueDate: string | null }[];
}

export interface DocumentRequestInput {
  rmName: string;
  accountName: string;
  recipientFirstName: string;
  items: { label: string; period?: string; dueDate: string; daysOverdue: number }[];
  reminder?: boolean;
}

export interface TalkingPointInput {
  ruleId: string;
  title: string;
  accountName: string;
  evidence: SourcedFact[];
}

export interface AskContext {
  accountNames: string[];
}

/**
 * Task-level model interface. `RuleModel` (mock mode) is deterministic; `LlmModel` (openai mode) calls the
 * LlmProvider with versioned prompts and falls back to the rules on any failure.
 */
export interface AgentModel {
  readonly name: string;
  extractDebrief(text: string, ctx: DebriefContext): Promise<DebriefExtraction>;
  classifyFlags(text: string): Promise<FlagClassification>;
  writeBriefSpoken(input: BriefSpeechInput): Promise<string>;
  answerFromFacts(question: string, facts: SourcedFact[]): Promise<{ answer: string; factKeys: string[] }>;
  draftClientRecap(input: RecapInput): Promise<{ subject: string; body: string }>;
  draftInternalHandoff(input: HandoffInput): Promise<{ subject: string; body: string }>;
  draftDocumentRequest(input: DocumentRequestInput): Promise<{ subject: string; body: string }>;
  phraseTalkingPoint(input: TalkingPointInput): Promise<{ rationale: string; question: string }>;
  extractDeal(text: string): Promise<DealExtraction>;
  parseAsk(text: string, ctx: AskContext): Promise<AskCommand>;
  summarizeNeed(text: string, specialty: Specialty, accountName: string): Promise<string>;
}
