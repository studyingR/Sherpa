import { z } from 'zod';
import { Account, Contact, Meeting, Opportunity, SourcedFact, Task } from './core';
import { DebriefDraft, FlowState } from './debrief';
import {
  Alert,
  CoverageItem,
  DocumentItem,
  FollowUpDraft,
  HealthScore,
  Referral,
  TalkingPoint,
} from './features';
import { WriteIntent, WriteResult } from './intents';
import { Mode } from './enums';

// ---------- Today ----------
export const BriefStatus = z.enum(['READY', 'NOT_READY', 'INTERNAL']);
export const TodayMeeting = Meeting.extend({
  accountName: z.string().nullable(),
  briefStatus: BriefStatus,
  ended: z.boolean(),
  debriefed: z.boolean(),
});
export type TodayMeeting = z.infer<typeof TodayMeeting>;

export const PendingDebrief = z.object({
  meetingId: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  subject: z.string(),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string()),
  resumeDraftId: z.string().nullable(),
});
export type PendingDebrief = z.infer<typeof PendingDebrief>;

export const TodayView = z.object({
  greeting: z.string(),
  date: z.string(),
  pendingDebriefs: z.array(PendingDebrief),
  meetings: z.array(TodayMeeting),
  commitmentsDue: z.array(Task),
  overdueTasks: z.array(Task),
  alerts: z.array(Alert),
  documentsDue: z.array(DocumentItem),
  coverageSuggestions: z.array(CoverageItem),
  atRisk: z.array(HealthScore).optional(),
});
export type TodayView = z.infer<typeof TodayView>;

export const AgendaResponse = z.object({ spoken: z.string(), view: TodayView });
export type AgendaResponse = z.infer<typeof AgendaResponse>;

// ---------- Accounts ----------
export const AccountSummary = Account.extend({
  lastTouchDays: z.number().nullable(),
  openAlerts: z.number(),
  documentsDue: z.number(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const DebriefSummary = z.object({
  id: z.string(),
  confirmedAt: z.string(),
  summary: z.string(),
  purpose: z.string(),
  complaint: z.boolean(),
});
export type DebriefSummary = z.infer<typeof DebriefSummary>;

export const AccountDetail = z.object({
  account: Account,
  overview: z.array(SourcedFact),
  credit: z.array(SourcedFact),
  deposits: z.array(SourcedFact),
  contacts: z.array(Contact),
  recentDebriefs: z.array(DebriefSummary),
  tasks: z.array(Task),
  opportunities: z.array(Opportunity),
  alerts: z.array(Alert),
  referrals: z.array(Referral),
  documents: z.array(DocumentItem),
  talkingPoints: z.array(TalkingPoint),
  health: HealthScore.nullable(),
  upcomingMeeting: Meeting.nullable(),
});
export type AccountDetail = z.infer<typeof AccountDetail>;

// ---------- Agent ----------
export const UiAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NAVIGATE'), route: z.string() }),
  z.object({ type: z.literal('SHOW_INTENT'), intentId: z.string() }),
  z.object({ type: z.literal('OPEN_BRIEF'), meetingId: z.string() }),
  z.object({ type: z.literal('OPEN_REVIEW'), draftId: z.string() }),
  z.object({ type: z.literal('OPEN_SAVED'), debriefId: z.string() }),
]);
export type UiAction = z.infer<typeof UiAction>;

export const AgentMessage = z.object({
  id: z.string(),
  speaker: z.enum(['AGENT', 'RM']),
  text: z.string(),
  kind: z.enum(['TEXT', 'FLAG', 'READ_BACK', 'QUESTION', 'RESULT']).default('TEXT'),
  at: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessage>;

export const FlagEvent = z.object({
  flag: z.enum(['COMPLAINT', 'MNPI', 'SENSITIVE']),
  message: z.string(),
});
export type FlagEvent = z.infer<typeof FlagEvent>;

export const AgentTurn = z.object({
  messages: z.array(AgentMessage),
  actions: z.array(UiAction),
  intent: WriteIntent.optional(),
  writeResult: WriteResult.optional(),
  draft: DebriefDraft.optional(),
  flags: z.array(FlagEvent).optional(),
  flowState: FlowState.optional(),
  followUps: z.array(FollowUpDraft).optional(),
});
export type AgentTurn = z.infer<typeof AgentTurn>;

export const AskRequest = z.object({
  text: z.string().min(1).max(2000),
  context: z.object({ accountId: z.string().optional(), screen: z.string().optional() }).optional(),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const TranscriptLine = z.object({
  speaker: z.enum(['AGENT', 'RM']),
  text: z.string(),
  at: z.string(),
  kind: AgentMessage.shape.kind.optional(),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export const VoiceSessionMode = Mode;
