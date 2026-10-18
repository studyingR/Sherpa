import { z } from 'zod';
import { MeetingType, Purpose, Specialty } from './enums';

export const NextStep = z.object({
  id: z.string(),
  title: z.string(),
  ownerType: z.enum(['RM', 'USER', 'TEAM']),
  ownerId: z.string().optional(),
  ownerName: z.string(),
  dueDate: z.string().nullable(),
  clientCommitment: z.boolean(),
  include: z.boolean(),
  relatedOpportunityId: z.string().optional(),
  /** Added by Sherpa (e.g. from specialist interest) rather than spoken by the RM. */
  suggested: z.boolean().optional(),
});
export type NextStep = z.infer<typeof NextStep>;

export const OpportunityProposal = z.object({
  id: z.string(),
  product: z.string(),
  amount: z.number().nullable(),
  closeQuarter: z.string().nullable(),
  stage: z.literal('Prospecting'),
  isNew: z.boolean(),
  existingOpportunityId: z.string().optional(),
  changes: z
    .object({ stage: z.string(), amount: z.number(), closeDate: z.string() })
    .partial()
    .optional(),
  approved: z.boolean(),
});
export type OpportunityProposal = z.infer<typeof OpportunityProposal>;

export const DebriefFlags = z.object({
  complaint: z.object({
    flagged: z.boolean(),
    summary: z.string().optional(),
    evidence: z.string().optional(),
    locked: z.literal(true),
  }),
  mnpi: z.object({ flagged: z.boolean(), evidence: z.string().optional() }),
  sensitive: z.object({
    flagged: z.boolean(),
    categories: z.array(z.string()).optional(),
    evidence: z.string().optional(),
    /** RM chose to keep the sensitive detail in the record; it is then routed to compliance (C-05). */
    kept: z.boolean().optional(),
  }),
  risk: z.object({ flagged: z.boolean(), summary: z.string().optional() }),
});
export type DebriefFlags = z.infer<typeof DebriefFlags>;

export const DebriefAttendee = z.object({
  name: z.string(),
  contactId: z.string().optional(),
  userId: z.string().optional(),
  role: z.string().optional(),
  external: z.boolean(),
});
export type DebriefAttendee = z.infer<typeof DebriefAttendee>;

export const ContactUpdate = z.object({
  contactId: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  email: z.string().optional(),
  approved: z.boolean(),
});
export type ContactUpdate = z.infer<typeof ContactUpdate>;

export const DebriefStatus = z.enum(['CAPTURING', 'REVIEW', 'CONFIRMED', 'ABANDONED']);

export const FlowState = z.enum([
  'MATCH_MEETING',
  'OPEN_FLOOR',
  'GAP_FILL',
  'READ_BACK',
  'APPROVE_OPPORTUNITY',
  'CONFIRM',
  'SAVED',
]);
export type FlowState = z.infer<typeof FlowState>;

export const GapType = z.enum([
  'COMPLAINT_FOLLOWUP',
  'NO_STEPS',
  'STEP_OWNER',
  'STEP_DATE',
  'STEP_OWNER_DATE',
  'OPP_AMOUNT',
  'OPP_TIMING',
  'PURPOSE',
]);
export type GapType = z.infer<typeof GapType>;
export const Gap = z.object({ type: GapType, ref: z.string().optional(), question: z.string() });
export type Gap = z.infer<typeof Gap>;

export const DebriefDraft = z.object({
  id: z.string(),
  sessionId: z.string(),
  rmId: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  meetingId: z.string().nullable(),
  meetingStart: z.string().nullable(),
  meetingType: MeetingType,
  purpose: Purpose,
  attendees: z.array(DebriefAttendee),
  summary: z.string(),
  clientNeeds: z.string(),
  riskSignals: z.string(),
  nextSteps: z.array(NextStep),
  opportunities: z.array(OpportunityProposal),
  specialistInterest: z.array(Specialty),
  contactUpdates: z.array(ContactUpdate),
  flags: DebriefFlags,
  missingFields: z.array(z.string()),
  gapQuestionsAsked: z.number(),
  pendingGap: Gap.nullable(),
  skippedGaps: z.array(z.string()),
  /** Opportunity currently awaiting a spoken yes/no. */
  pendingApprovalId: z.string().nullable(),
  noNextSteps: z.boolean(),
  status: DebriefStatus,
  flowState: FlowState,
  updatedAt: z.string(),
});
export type DebriefDraft = z.infer<typeof DebriefDraft>;

/** Edits from the review card. Complaint flag cannot be cleared (F01-AC4: 409). */
export const DebriefDraftPatch = z.object({
  summary: z.string().optional(),
  clientNeeds: z.string().optional(),
  riskSignals: z.string().optional(),
  purpose: Purpose.optional(),
  nextSteps: z
    .array(
      z.object({
        id: z.string(),
        include: z.boolean().optional(),
        title: z.string().optional(),
        ownerName: z.string().optional(),
        dueDate: z.string().nullable().optional(),
      }),
    )
    .optional(),
  opportunities: z
    .array(
      z.object({
        id: z.string(),
        approved: z.boolean().optional(),
        amount: z.number().nullable().optional(),
        closeQuarter: z.string().nullable().optional(),
      }),
    )
    .optional(),
  specialistInterest: z.array(Specialty).optional(),
  contactUpdates: z.array(z.object({ name: z.string(), approved: z.boolean() })).optional(),
  flags: z
    .object({
      complaint: z.object({ flagged: z.boolean() }).partial().optional(),
      sensitive: z.object({ flagged: z.boolean(), kept: z.boolean() }).partial().optional(),
    })
    .optional(),
});
export type DebriefDraftPatch = z.infer<typeof DebriefDraftPatch>;

export const ProposedMeeting = z.object({
  meetingId: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  city: z.string(),
  subject: z.string(),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string()),
});
export type ProposedMeeting = z.infer<typeof ProposedMeeting>;

export const StartDebriefRequest = z.object({
  meetingId: z.string().optional(),
  accountId: z.string().optional(),
  channel: z.enum(['APP', 'CHAT']),
  resumeDraftId: z.string().optional(),
  /** Discard any resumable draft and start fresh. */
  startOver: z.boolean().optional(),
});
export type StartDebriefRequest = z.infer<typeof StartDebriefRequest>;

export const ResumeOffer = z.object({ draftId: z.string(), accountName: z.string(), updatedAt: z.string() });

export const StartDebriefResponse = z.object({
  sessionId: z.string(),
  draftId: z.string(),
  proposedMeeting: ProposedMeeting.nullable(),
  resumeOf: ResumeOffer.nullable(),
  opening: z.string(),
  draft: DebriefDraft,
});
export type StartDebriefResponse = z.infer<typeof StartDebriefResponse>;

export const ChatRequest = z.object({ text: z.string().min(1).max(4000) });

export const WrittenItem = z.object({
  kind: z.string(),
  label: z.string(),
  system: z.string(),
  externalId: z.string().optional(),
});
export type WrittenItem = z.infer<typeof WrittenItem>;

export const HeldItem = z.object({ kind: z.string(), label: z.string(), reason: z.string() });
export type HeldItem = z.infer<typeof HeldItem>;

export const DebriefDetail = z.object({
  id: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  confirmedAt: z.string(),
  confirmedBy: z.string(),
  salesforceId: z.string(),
  draft: DebriefDraft,
  written: z.array(WrittenItem),
  held: z.array(HeldItem),
  firstClientContact: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type DebriefDetail = z.infer<typeof DebriefDetail>;
