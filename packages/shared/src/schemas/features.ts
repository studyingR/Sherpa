import { z } from 'zod';
import { SourcedFact } from './core';
import { AlertRule, DealProduct, DocumentType, Severity, Source, Specialty } from './enums';

// ---------- F02 Brief ----------
export const BriefSectionId = z.enum([
  'overview',
  'contacts',
  'touchpoints',
  'commitments',
  'credit',
  'deposits',
  'opportunities',
  'alerts',
  'documents',
  'talkingPoints',
  'news',
  'health',
]);
export type BriefSectionId = z.infer<typeof BriefSectionId>;

export const BriefItem = z.object({
  title: z.string(),
  detail: z.string().optional(),
  source: Source,
  asOf: z.string(),
  ref: z.string().optional(),
});
export type BriefItem = z.infer<typeof BriefItem>;

export const BriefSection = z.object({
  id: BriefSectionId,
  title: z.string(),
  facts: z.array(SourcedFact),
  items: z.array(BriefItem).optional(),
});
export type BriefSection = z.infer<typeof BriefSection>;

export const Brief = z.object({
  meetingId: z.string().nullable(),
  accountId: z.string(),
  accountName: z.string(),
  meeting: z
    .object({ subject: z.string(), start: z.string(), attendees: z.array(z.string()) })
    .nullable(),
  generatedAt: z.string(),
  sections: z.array(BriefSection),
  missingSources: z.array(Source),
  spoken: z.string(),
  spokenPrivate: z.string(),
});
export type Brief = z.infer<typeof Brief>;

export const AskBriefRequest = z.object({ question: z.string().min(1).max(500) });
export const AskBriefResponse = z.object({ answer: z.string(), facts: z.array(SourcedFact) });
export type AskBriefResponse = z.infer<typeof AskBriefResponse>;

// ---------- F03 Follow-up drafts ----------
export const GuardResult = z.object({
  passed: z.boolean(),
  removed: z.array(z.object({ phrase: z.string(), reason: z.string() })),
  message: z.string(),
});
export type GuardResult = z.infer<typeof GuardResult>;

export const Recipient = z.object({
  name: z.string(),
  email: z.string(),
  contactId: z.string().optional(),
  userId: z.string().optional(),
});
export type Recipient = z.infer<typeof Recipient>;

export const FollowUpDraft = z.object({
  id: z.string(),
  debriefId: z.string().nullable(),
  accountId: z.string(),
  kind: z.enum(['CLIENT', 'INTERNAL']),
  team: z.string().optional(),
  to: z.array(Recipient),
  cc: z.array(Recipient),
  subject: z.string(),
  body: z.string(),
  guardResult: GuardResult,
  mailDraftId: z.string().nullable(),
  status: z.enum(['DRAFT', 'SAVED_TO_MAILBOX']),
  reminderDays: z.array(z.number()).optional(),
});
export type FollowUpDraft = z.infer<typeof FollowUpDraft>;

export const CreateDraftsRequest = z.object({ kinds: z.array(z.enum(['CLIENT', 'INTERNAL'])).min(1) });
export const PatchDraftRequest = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
});

// ---------- F04 Tasks ----------
export const TaskActionRequest = z.object({
  action: z.enum(['COMPLETE', 'RESCHEDULE', 'DELEGATE']),
  dueDate: z.string().optional(),
  delegateTo: z.string().optional(),
});
export type TaskActionRequest = z.infer<typeof TaskActionRequest>;

// ---------- F05 Referrals ----------
export const ReferralStatus = z.enum(['SUBMITTED', 'ACCEPTED', 'CONTACTED', 'OPPORTUNITY_CREATED', 'CLOSED']);
export const Urgency = z.enum(['LOW', 'NORMAL', 'HIGH']);
export const Referral = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  contactId: z.string().optional(),
  specialty: Specialty,
  needSummary: z.string(),
  urgency: Urgency,
  routedTo: z.object({ queue: z.string(), userId: z.string().optional() }),
  status: ReferralStatus,
  consentToShare: z.boolean(),
  createdAt: z.string(),
  salesforceId: z.string().optional(),
});
export type Referral = z.infer<typeof Referral>;

export const ReferralIntentRequest = z.object({
  accountId: z.string(),
  specialty: Specialty,
  contactId: z.string().optional(),
  needSummary: z.string().min(1),
  urgency: Urgency,
  consentToShare: z.boolean(),
  debriefId: z.string().optional(),
});
export type ReferralIntentRequest = z.infer<typeof ReferralIntentRequest>;

export const RoutePreview = z.object({ queue: z.string(), userId: z.string().optional(), fallback: z.boolean() });
export type RoutePreview = z.infer<typeof RoutePreview>;

// ---------- F06 Alerts ----------
export const AlertStatus = z.enum(['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'DISMISSED', 'RESOLVED']);
export const Alert = z.object({
  id: z.string(),
  rmId: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  rule: AlertRule,
  severity: Severity,
  title: z.string(),
  evidence: z.array(SourcedFact),
  suggestedAction: z.string(),
  status: AlertStatus,
  snoozeUntil: z.string().optional(),
  createdAt: z.string(),
});
export type Alert = z.infer<typeof Alert>;

export const AlertActionRequest = z.object({
  action: z.enum(['ACK', 'SNOOZE', 'DISMISS', 'CREATE_TASK']),
  snoozeDays: z.union([z.literal(7), z.literal(30)]).optional(),
  reason: z.string().optional(),
});
export type AlertActionRequest = z.infer<typeof AlertActionRequest>;

// ---------- F07 Deals ----------
export const DealDraft = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  borrower: z.string(),
  guarantors: z.array(z.string()),
  product: DealProduct.nullable(),
  amount: z.number().nullable(),
  purpose: z.string(),
  termMonths: z.number().nullable(),
  amortizationMonths: z.number().nullable(),
  collateral: z.string(),
  requestedTiming: z.string(),
  useOfProceeds: z.string(),
  knownRisks: z.string(),
  existingExposure: z.array(SourcedFact),
  missingFields: z.array(z.string()),
  questionsAsked: z.number(),
  pendingField: z.string().nullable(),
  awaitingReadBack: z.boolean(),
  readBackDone: z.boolean(),
  status: z.enum(['CAPTURING', 'READY', 'DRAFT_CREATED']),
  ncinoDraftId: z.string().optional(),
  opportunityId: z.string().optional(),
});
export type DealDraft = z.infer<typeof DealDraft>;

export const DealDraftPatch = DealDraft.pick({
  guarantors: true,
  product: true,
  amount: true,
  purpose: true,
  termMonths: true,
  amortizationMonths: true,
  collateral: true,
  requestedTiming: true,
  useOfProceeds: true,
  knownRisks: true,
  readBackDone: true,
}).partial();
export type DealDraftPatch = z.infer<typeof DealDraftPatch>;

// ---------- F08 Documents ----------
export const DocumentItem = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  type: DocumentType,
  period: z.string().optional(),
  dueDate: z.string(),
  daysOverdue: z.number(),
  lastRequestedAt: z.string().optional(),
  status: z.enum(['OUTSTANDING', 'RECEIVED', 'WAIVED']),
  source: Source,
});
export type DocumentItem = z.infer<typeof DocumentItem>;

export const DocumentRequestDraftRequest = z.object({
  itemIds: z.array(z.string()).min(1),
  reminderDays: z.array(z.number()).optional(),
});

// ---------- F09 Talking points ----------
export const TalkingPoint = z.object({
  id: z.string(),
  accountId: z.string(),
  title: z.string(),
  rationale: z.string(),
  question: z.string(),
  evidence: z.array(SourcedFact),
  ruleId: z.string(),
  feedback: z.enum(['UP', 'DOWN']).optional(),
});
export type TalkingPoint = z.infer<typeof TalkingPoint>;

// ---------- F10 Coverage ----------
export const CoverageItem = z.object({
  accountId: z.string(),
  accountName: z.string(),
  daysSinceTouch: z.number(),
  targetDays: z.number(),
  overdueBy: z.number(),
  score: z.number(),
  reasons: z.array(z.string()),
  planStatus: z.enum(['SUGGESTED', 'ACCEPTED', 'SKIPPED', 'SCHEDULED']).optional(),
});
export type CoverageItem = z.infer<typeof CoverageItem>;

export const CoveragePlan = z.object({
  id: z.string(),
  weekOf: z.string(),
  items: z.array(CoverageItem),
  coveragePct: z.number(),
});
export type CoveragePlan = z.infer<typeof CoveragePlan>;

export const CoverageActionRequest = z.object({
  action: z.enum(['ACCEPT', 'SKIP', 'SCHEDULE']),
  reason: z.string().optional(),
  slot: z.string().optional(),
});

// ---------- F11 Live ----------
export const LiveStartRequest = z.object({
  meetingId: z.string(),
  jurisdiction: z.string().length(2),
  allPartyConsentConfirmed: z.boolean(),
  consentStatement: z.string(),
});

// ---------- F12 Pricing ----------
export const PricingGuidance = z.object({
  dealId: z.string(),
  spreadBpsRange: z.tuple([z.number(), z.number()]),
  feeRange: z.tuple([z.number(), z.number()]).optional(),
  targetRaroc: z.number(),
  drivers: z.array(z.object({ label: z.string(), impactBps: z.number() })),
  requiresApproval: z.boolean(),
  disclaimer: z.string(),
});
export type PricingGuidance = z.infer<typeof PricingGuidance>;

// ---------- F13 Health ----------
export const HealthBand = z.enum(['HEALTHY', 'WATCH', 'AT_RISK']);
export type HealthBand = z.infer<typeof HealthBand>;
export const HealthScore = z.object({
  accountId: z.string(),
  accountName: z.string(),
  score: z.number(),
  band: HealthBand,
  drivers: z.array(z.object({ factor: z.string(), impact: z.number(), fact: SourcedFact })),
  computedAt: z.string(),
  history: z.array(z.object({ at: z.string(), score: z.number() })).optional(),
});
export type HealthScore = z.infer<typeof HealthScore>;

// ---------- Audit + compliance ----------
export const AuditEvent = z.object({
  id: z.string(),
  at: z.string(),
  rmId: z.string(),
  action: z.string(),
  target: z.object({ system: Source, object: z.string(), id: z.string().optional() }),
  intentId: z.string().optional(),
  confirmation: z.object({ channel: z.enum(['voice', 'tap']), utterance: z.string().optional() }).optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  requestId: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const ComplianceItem = z.object({
  id: z.string(),
  type: z.enum(['COMPLAINT', 'MNPI', 'SENSITIVE']),
  accountId: z.string(),
  accountName: z.string(),
  rmId: z.string(),
  rmName: z.string(),
  excerpt: z.string(),
  debriefId: z.string().nullable(),
  caseId: z.string().nullable(),
  status: z.enum(['OPEN', 'RESOLVED']),
  resolverNote: z.string().nullable(),
  createdAt: z.string(),
});
export type ComplianceItem = z.infer<typeof ComplianceItem>;

// ---------- Preferences + notifications ----------
export const Preferences = z.object({
  morningAgendaTime: z.string().regex(/^\d{2}:\d{2}$/),
  cadence: z.enum(['MORNING', 'MORNING_AFTERNOON']),
  channels: z.object({ push: z.boolean(), inApp: z.boolean() }),
  quietHours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }),
  mutedTypes: z.array(z.string()),
  privacyMode: z.boolean(),
  voiceSpeed: z.number().min(0.75).max(1.5),
  meetingReminderMinutes: z.number().int().min(5).max(120),
  phonePinSet: z.boolean(),
});
export type Preferences = z.infer<typeof Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
  morningAgendaTime: '07:45',
  cadence: 'MORNING',
  channels: { push: true, inApp: true },
  quietHours: { enabled: true, start: '20:00', end: '07:00' },
  mutedTypes: [],
  privacyMode: true,
  voiceSpeed: 1,
  meetingReminderMinutes: 30,
  phonePinSet: false,
};

export const Notification = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  deepLink: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  suppressedReason: z.string().nullable(),
  readAt: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;
