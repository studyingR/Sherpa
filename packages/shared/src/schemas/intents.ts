import { z } from 'zod';
import { HeldItem, WrittenItem } from './debrief';

export const WriteIntentKind = z.enum([
  'debrief.save',
  'task.create',
  'task.update',
  'task.delegate',
  'referral.create',
  'deal.draft',
  'calendar.hold',
  'mail.draft',
  'alert.action',
  'contact.upsert',
]);
export type WriteIntentKind = z.infer<typeof WriteIntentKind>;

export const ApprovalItem = z.object({
  id: z.string(),
  kind: z.enum(['OPPORTUNITY_CREATE', 'OPPORTUNITY_UPDATE', 'CONTACT_UPSERT', 'TASK_DELEGATE']),
  label: z.string(),
});
export type ApprovalItem = z.infer<typeof ApprovalItem>;

/** A human-readable line describing one write the intent will perform. */
export const PlannedWrite = z.object({
  system: z.string(),
  label: z.string(),
  approvalId: z.string().optional(),
});
export type PlannedWrite = z.infer<typeof PlannedWrite>;

export const WriteIntent = z.object({
  id: z.string(),
  rmId: z.string(),
  kind: WriteIntentKind,
  payload: z.unknown(),
  summary: z.string(),
  planned: z.array(PlannedWrite),
  requiresApproval: z.array(ApprovalItem),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type WriteIntent = z.infer<typeof WriteIntent>;

export const Confirmation = z.object({
  intentId: z.string(),
  confirmedBy: z.string().optional(),
  channel: z.enum(['voice', 'tap']),
  approvals: z.record(z.string(), z.boolean()),
  utterance: z.string().optional(),
});
export type Confirmation = z.infer<typeof Confirmation>;

export const WriteResult = z.object({
  intentId: z.string(),
  debriefId: z.string().optional(),
  written: z.array(WrittenItem),
  held: z.array(HeldItem),
  resultRef: z.string().optional(),
});
export type WriteResult = z.infer<typeof WriteResult>;
