import type {
  Account,
  Contact,
  Meeting,
  Opportunity,
  Role,
  Task,
  User,
} from '@sherpa/shared';

/** Passed first to every adapter call (docs/02 §3). */
export interface RequestContext {
  rmId: string;
  role: Role;
  /** Account IDs this user may read/write (their book; team book for leaders, read-only). */
  bookAccountIds: ReadonlySet<string>;
  teamRmIds: readonly string[];
  requestId: string;
}

export class UpstreamUnavailableError extends Error {
  constructor(public system: string) {
    super(`${system} isn't responding.`);
  }
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet (live adapter).`);
  }
}

// ---------------- Identity ----------------
export interface IdentityAdapter {
  listPersonas(): Promise<(User & { description: string })[]>;
  signIn(personaId: string): Promise<User>;
  getUser(userId: string): Promise<User | null>;
  /** Phone channel: push approval or PIN against a registered device. Caller ID alone never suffices (C-12). */
  verifyPhone(input: { userId: string; pin?: string; pushApproved?: boolean; callerId?: string }): Promise<boolean>;
}

// ---------------- Salesforce ----------------
export interface ActivityRecord {
  id: string;
  accountId: string;
  type: 'MEETING' | 'CALL' | 'EMAIL' | 'DEBRIEF';
  subject: string;
  date: string;
}

export interface CaseRecord {
  id: string;
  accountId: string;
  contactId?: string;
  recordType: string;
  subject: string;
  description: string;
  queue: string;
  createdAt: string;
}

export interface SalesforceAdapter {
  getAccount(ctx: RequestContext, accountId: string): Promise<(Account & { profile: Record<string, unknown> }) | null>;
  listAccounts(ctx: RequestContext, filter: { ownerRmIds: string[]; query?: string; segment?: string }): Promise<Account[]>;
  getContacts(ctx: RequestContext, accountId: string): Promise<Contact[]>;
  getActivities(ctx: RequestContext, accountId: string, limit: number): Promise<ActivityRecord[]>;
  getLastTouch(ctx: RequestContext, accountIds: string[]): Promise<Record<string, string | null>>;
  getOpenOpportunities(ctx: RequestContext, accountId: string): Promise<Opportunity[]>;
  getOpenCases(ctx: RequestContext, accountId: string): Promise<CaseRecord[]>;
  getTasks(ctx: RequestContext, filter: { bookRmIds: string[]; accountId?: string; status?: 'OPEN' | 'COMPLETED'; commitment?: boolean }): Promise<Task[]>;
  getTask(ctx: RequestContext, taskId: string): Promise<(Task & { bookRmId: string }) | null>;
  listUsers(ctx: RequestContext): Promise<User[]>;
  // ---- writes (only ever called by WriteGateway) ----
  createDebrief(ctx: RequestContext, fields: Record<string, unknown>): Promise<{ id: string }>;
  createAttendees(ctx: RequestContext, debriefId: string, attendees: { name: string; contactId?: string; userId?: string; role?: string }[]): Promise<{ ids: string[] }>;
  createTasks(ctx: RequestContext, tasks: { accountId: string | null; bookRmId: string; ownerId?: string; ownerName: string; subject: string; dueDate: string | null; clientCommitment: boolean; debriefId?: string; whatId?: string }[]): Promise<{ ids: string[] }>;
  updateTask(ctx: RequestContext, taskId: string, changes: { status?: 'OPEN' | 'COMPLETED'; dueDate?: string; ownerId?: string; ownerName?: string }): Promise<{ before: Task; after: Task }>;
  createOpportunity(ctx: RequestContext, opp: { accountId: string; name: string; amount: number | null; closeDate: string | null; stage: string; leadSource: string; product: string }): Promise<{ id: string }>;
  updateOpportunity(ctx: RequestContext, id: string, changes: { stage?: string; amount?: number; closeDate?: string }): Promise<{ before: Opportunity; after: Opportunity }>;
  upsertContact(ctx: RequestContext, contact: { id?: string; accountId: string; name: string; title?: string; email?: string }): Promise<{ id: string; created: boolean }>;
  updateEvent(ctx: RequestContext, eventId: string, changes: { appendDescription?: string; debriefId?: string }): Promise<void>;
  createReferral(ctx: RequestContext, fields: Record<string, unknown> & { accountId: string }): Promise<{ id: string }>;
  updateReferral(ctx: RequestContext, id: string, changes: { status: string }): Promise<void>;
  createComplaintCase(ctx: RequestContext, c: { accountId: string; contactId?: string; subject: string; description: string }): Promise<{ id: string; queue: string }>;
  logActivity(ctx: RequestContext, a: { accountId: string; type: ActivityRecord['type']; subject: string }): Promise<void>;
}

// ---------------- nCino / ACBS / deposits / PL ----------------
export interface LoanRecord {
  id: string;
  accountId: string;
  product: string;
  commitment: number;
  outstanding: number;
  riskRating: number;
  prevRiskRating: number | null;
  ratingChangedAt: string | null;
  maturityDate: string;
  renewalOppOpen: boolean;
  asOf: string;
}
export interface CovenantRecord {
  id: string;
  accountId: string;
  loanId: string;
  name: string;
  metric: 'DSCR' | 'LEVERAGE';
  operator: '>=' | '<=';
  threshold: number;
  testDueDate: string;
}
export interface TicklerRecord {
  id: string;
  accountId: string;
  type: string;
  period: string | null;
  dueDate: string;
  lastRequestedAt: string | null;
  status: 'OUTSTANDING' | 'RECEIVED' | 'WAIVED';
}
export interface SpreadRecord {
  accountId: string;
  period: string;
  dscr: number;
  leverage: number;
  asOf: string;
}

export interface NcinoAdapter {
  getLoans(ctx: RequestContext, accountId: string): Promise<LoanRecord[]>;
  getCovenants(ctx: RequestContext, accountId: string): Promise<CovenantRecord[]>;
  getTicklers(ctx: RequestContext, accountId: string): Promise<TicklerRecord[]>;
  getRiskRating(ctx: RequestContext, accountId: string): Promise<{ rating: number; previous: number | null; changedAt: string | null } | null>;
  getSpreads(ctx: RequestContext, accountId: string): Promise<SpreadRecord[]>;
  /** Creates a DRAFT request only. There is no submit method (F07-FR4). */
  createDraftRequest(ctx: RequestContext, payload: Record<string, unknown> & { accountId: string }): Promise<{ id: string; status: string }>;
  markTickler(ctx: RequestContext, ticklerId: string, status: 'RECEIVED' | 'WAIVED'): Promise<void>;
}

export interface AcbsAdapter {
  getFacilityBalances(ctx: RequestContext, accountId: string): Promise<{ facilityId: string; outstanding: number; commitment: number; asOf: string }[]>;
  getUtilizationHistory(ctx: RequestContext, facilityId: string, days: number): Promise<{ date: string; utilization: number }[]>;
}

export interface CoreDepositsAdapter {
  getBalances(ctx: RequestContext, accountId: string): Promise<{ balance: number; asOf: string }>;
  getBalanceHistory(ctx: RequestContext, accountId: string, days: number): Promise<{ date: string; balance: number }[]>;
  getTreasuryProducts(ctx: RequestContext, accountId: string): Promise<{ product: string; since: string }[]>;
}

export interface PricingParams {
  dealId: string;
  accountId: string;
  product: string;
  amount: number;
  termMonths: number | null;
  riskRating: number;
}
export interface PrecisionLenderAdapter {
  getRelationshipProfitability(ctx: RequestContext, accountId: string): Promise<{ raroc: number; revenue12m: number; depositSpreadCredit: number; asOf: string } | null>;
  getPricingGuidance(ctx: RequestContext, params: PricingParams): Promise<{ spreadBpsRange: [number, number]; feeRange: [number, number]; targetRaroc: number; drivers: { label: string; impactBps: number }[]; rmAuthorityMaxBps: number }>;
}

// ---------------- Calendar / Mail / News / KYC / Push / Archive ----------------
export interface CalendarAdapter {
  listMeetings(ctx: RequestContext, range: { from: Date; to: Date; ownerRmIds: string[] }): Promise<Meeting[]>;
  getMeeting(ctx: RequestContext, meetingId: string): Promise<(Meeting & { ownerRmId: string; debriefId: string | null }) | null>;
  createHold(ctx: RequestContext, hold: { accountId?: string; title: string; start: Date; end: Date }): Promise<{ id: string }>;
}

export interface MailMessage {
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  subject: string;
  body: string;
  scheduledFor?: string;
}
/** C-07: deliberately has NO send method. Drafts only. */
export interface MailAdapter {
  createDraft(ctx: RequestContext, message: MailMessage): Promise<{ id: string }>;
}

export interface NewsAdapter {
  getNews(ctx: RequestContext, accountId: string, days: number): Promise<{ id: string; headline: string; outlet: string; publishedAt: string; summary: string }[]>;
}

export interface KycAdapter {
  getRefreshRequirements(ctx: RequestContext, accountId: string): Promise<{ id: string; type: string; dueDate: string; status: string }[]>;
  markRequirement(ctx: RequestContext, id: string, status: 'RECEIVED' | 'WAIVED'): Promise<void>;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  deepLink?: string;
}
export interface PushAdapter {
  send(rmId: string, pushToken: string | null, n: PushNotificationPayload): Promise<{ delivered: boolean }>;
}

export interface ArchiveAdapter {
  storeTranscript(ctx: RequestContext, transcript: { sessionId: string; lines: { speaker: string; text: string; at: string }[] }): Promise<{ ref: string }>;
}

export interface TelephonyAdapter {
  /** Mock harness only in this build: simulates an inbound call that runs the same voice session. */
  onInboundCall(handler: (call: { callId: string; callerId: string }) => void): void;
  simulateInboundCall(callerId: string): Promise<{ callId: string }>;
}

/** Partner notifications for referrals and deal events (mock: call log only). */
export interface EventBusAdapter {
  publish(ctx: RequestContext, topic: 'referral.created' | 'deal.draft_created' | 'complaint.routed', payload: Record<string, unknown>): Promise<void>;
}

export interface Adapters {
  identity: IdentityAdapter;
  salesforce: SalesforceAdapter;
  ncino: NcinoAdapter;
  acbs: AcbsAdapter;
  deposits: CoreDepositsAdapter;
  precisionLender: PrecisionLenderAdapter;
  calendar: CalendarAdapter;
  mail: MailAdapter;
  news: NewsAdapter;
  kyc: KycAdapter;
  push: PushAdapter;
  archive: ArchiveAdapter;
  telephony: TelephonyAdapter;
  events: EventBusAdapter;
}
