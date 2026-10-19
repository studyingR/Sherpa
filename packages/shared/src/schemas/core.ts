import { z } from 'zod';
import { CoverageTier, MeetingType, Role, Segment, Source } from './enums';

export const SourcedFact = z.object({
  key: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  display: z.string(),
  source: Source,
  asOf: z.string(),
});
export type SourcedFact = z.infer<typeof SourcedFact>;

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: Role,
  segment: Segment.nullable(),
  region: z.string().nullable(),
  teamId: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const Persona = User.extend({ description: z.string() });
export type Persona = z.infer<typeof Persona>;

export const SignInRequest = z.object({ personaId: z.string() });
export const SignInResponse = z.object({ token: z.string(), user: User });
export type SignInResponse = z.infer<typeof SignInResponse>;

export const Account = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  segment: Segment,
  coverageTier: CoverageTier,
  ownerRmId: z.string(),
  industry: z.string(),
  annualRevenueBand: z.string(),
  relationshipSince: z.string(),
});
export type Account = z.infer<typeof Account>;

export const Contact = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  title: z.string(),
  email: z.string(),
  phone: z.string().optional(),
  isPrimary: z.boolean(),
});
export type Contact = z.infer<typeof Contact>;

export const MeetingAttendee = z.object({
  name: z.string(),
  email: z.string(),
  contactId: z.string().optional(),
  userId: z.string().optional(),
  external: z.boolean(),
});

export const Meeting = z.object({
  id: z.string(),
  accountId: z.string().nullable(),
  subject: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string().optional(),
  type: MeetingType,
  attendees: z.array(MeetingAttendee),
});
export type Meeting = z.infer<typeof Meeting>;

export const TaskStatus = z.enum(['OPEN', 'COMPLETED']);
export const Task = z.object({
  id: z.string(),
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  subject: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string(),
  dueDate: z.string().nullable(),
  status: TaskStatus,
  clientCommitment: z.boolean(),
  debriefId: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;

export const Opportunity = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  stage: z.string(),
  closeDate: z.string().nullable(),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
