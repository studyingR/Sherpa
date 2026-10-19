# 03 — Data Model

Two layers:

1. **Sherpa's own database** (Prisma): sessions, drafts, intents, audit, alerts, preferences, caches, and the mock tables that stand in for external systems.
2. **External system objects** (Salesforce etc.), accessed only through adapters. In this build they live in `mock_*` tables.

All IDs are strings (uuid for Sherpa records; Salesforce-style 18-char IDs for mock Salesforce records, e.g. `001Mock000000Acme1`).

## 1. Domain types (`packages/shared/src/types`)

```ts
export type Segment = 'COMMERCIAL' | 'SMALL_BUSINESS';
export type CoverageTier = 'A' | 'B' | 'C';
export type Source = 'SALESFORCE' | 'NCINO' | 'ACBS' | 'CORE_DEPOSITS' | 'PRECISION_LENDER' | 'NEWS' | 'CALENDAR' | 'SHERPA' | 'KYC';

export interface SourcedFact<T = string | number> {
  key: string;            // e.g. 'loan.utilization'
  label: string;          // 'Line utilization'
  value: T;
  display: string;        // '62%'
  source: Source;
  asOf: string;           // ISO datetime
}

export interface Rm { id: string; name: string; email: string; segment: Segment; region: string; teamId: string; role: 'RM' | 'ANALYST' | 'LEADER' | 'COMPLIANCE'; }

export interface Account {
  id: string; name: string; city: string; state: string; segment: Segment; coverageTier: CoverageTier;
  ownerRmId: string; industry: string; annualRevenueBand: string; relationshipSince: string;
}

export interface Contact { id: string; accountId: string; name: string; title: string; email: string; phone?: string; isPrimary: boolean; }

export interface Meeting {
  id: string; accountId: string | null; subject: string; start: string; end: string;
  location?: string; type: 'IN_PERSON' | 'VIRTUAL' | 'PHONE' | 'SITE_VISIT';
  attendees: { name: string; email: string; contactId?: string; userId?: string; external: boolean }[];
}

export interface NextStep {
  id: string; title: string; ownerType: 'RM' | 'USER' | 'TEAM'; ownerId?: string; ownerName: string;
  dueDate: string | null; clientCommitment: boolean; include: boolean; relatedOpportunityId?: string;
}

export interface OpportunityProposal {
  id: string; product: string; amount: number | null; closeQuarter: string | null; stage: 'Prospecting';
  isNew: boolean; existingOpportunityId?: string; changes?: Partial<{ stage: string; amount: number; closeDate: string }>;
  approved: boolean;  // must be explicitly set true by RM
}

export type Specialty = 'TREASURY_MANAGEMENT' | 'FX' | 'WEALTH' | 'SBA' | 'CAPITAL_MARKETS' | 'EQUIPMENT_FINANCE' | 'MERCHANT_SERVICES';

export interface DebriefFlags {
  complaint: { flagged: boolean; summary?: string; evidence?: string; locked: true };
  mnpi: { flagged: boolean; evidence?: string };
  sensitive: { flagged: boolean; categories?: string[] };
  risk: { flagged: boolean; summary?: string };
}

export interface DebriefDraft {
  id: string; sessionId: string; rmId: string; accountId: string; meetingId: string | null;
  meetingType: Meeting['type']; purpose: 'ANNUAL_REVIEW' | 'NEW_CREDIT' | 'RENEWAL' | 'TREASURY_REVIEW' | 'CHECK_IN' | 'ISSUE_RESOLUTION' | 'OTHER';
  attendees: { name: string; contactId?: string; userId?: string; role?: string; external: boolean }[];
  summary: string; clientNeeds: string; riskSignals: string;
  nextSteps: NextStep[]; opportunities: OpportunityProposal[];
  specialistInterest: Specialty[];
  contactUpdates: { contactId?: string; name: string; title?: string; email?: string; approved: boolean }[];
  flags: DebriefFlags;
  missingFields: string[]; gapQuestionsAsked: number;
  status: 'CAPTURING' | 'REVIEW' | 'CONFIRMED' | 'ABANDONED';
  updatedAt: string;
}

export interface Brief {
  meetingId: string | null; accountId: string; generatedAt: string;
  sections: { id: 'overview' | 'contacts' | 'touchpoints' | 'commitments' | 'credit' | 'deposits' | 'opportunities' | 'alerts' | 'documents' | 'talkingPoints' | 'news' | 'health'; title: string; facts: SourcedFact[]; items?: unknown[] }[];
  missingSources: Source[];
  spoken: string;            // ≤ 230 words
}

export interface Alert {
  id: string; rmId: string; accountId: string; rule: AlertRule; severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string; evidence: SourcedFact[]; suggestedAction: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'DISMISSED' | 'RESOLVED'; snoozeUntil?: string; createdAt: string;
}
export type AlertRule = 'MATURITY_APPROACHING' | 'COVENANT_TEST_DUE' | 'COVENANT_BREACH_RISK' | 'FINANCIALS_PAST_DUE' | 'UTILIZATION_SWING' | 'DEPOSIT_OUTFLOW' | 'RISK_RATING_DOWNGRADE';

export interface Referral { id: string; accountId: string; contactId?: string; specialty: Specialty; needSummary: string; urgency: 'LOW' | 'NORMAL' | 'HIGH'; routedTo: { queue: string; userId?: string }; status: 'SUBMITTED' | 'ACCEPTED' | 'CONTACTED' | 'OPPORTUNITY_CREATED' | 'CLOSED'; consentToShare: boolean; createdAt: string; }

export interface DealDraft {
  id: string; accountId: string; borrower: string; guarantors: string[];
  product: 'TERM_LOAN' | 'LINE_OF_CREDIT' | 'EQUIPMENT' | 'CRE' | 'SBA_7A' | 'SBA_504';
  amount: number | null; purpose: string; termMonths: number | null; amortizationMonths: number | null;
  collateral: string; requestedTiming: string; useOfProceeds: string; knownRisks: string;
  existingExposure: SourcedFact[]; missingFields: string[];
  status: 'CAPTURING' | 'READY' | 'DRAFT_CREATED'; ncinoDraftId?: string; opportunityId?: string;
}

export interface DocumentItem { id: string; accountId: string; type: 'FINANCIAL_STATEMENT' | 'TAX_RETURN' | 'COMPLIANCE_CERT' | 'INSURANCE' | 'BORROWING_BASE' | 'KYC_REFRESH'; period?: string; dueDate: string; daysOverdue: number; lastRequestedAt?: string; status: 'OUTSTANDING' | 'RECEIVED' | 'WAIVED'; source: Source; }

export interface TalkingPoint { id: string; accountId: string; title: string; rationale: string; question: string; evidence: SourcedFact[]; ruleId: string; feedback?: 'UP' | 'DOWN'; }

export interface CoverageItem { accountId: string; daysSinceTouch: number; targetDays: number; overdueBy: number; score: number; reasons: string[]; }

export interface HealthScore { accountId: string; score: number; band: 'HEALTHY' | 'WATCH' | 'AT_RISK'; drivers: { factor: string; impact: number; fact: SourcedFact }[]; computedAt: string; }

export interface PricingGuidance { dealId: string; spreadBpsRange: [number, number]; feeRange?: [number, number]; targetRaroc: number; drivers: { label: string; impactBps: number }[]; requiresApproval: boolean; disclaimer: string; }

export interface AuditEvent { id: string; at: string; rmId: string; action: string; target: { system: Source; object: string; id?: string }; intentId?: string; confirmation?: { channel: 'voice' | 'tap'; utterance?: string }; before?: unknown; after?: unknown; requestId: string; }
```

## 2. Prisma schema (Sherpa tables)

Implement in `apps/server/prisma/schema.prisma`. JSON columns use `String` in SQLite (serialize with zod) and `Json` in Postgres; use a Prisma field type that works for both (store as `String` and parse).

| Model | Key fields |
|---|---|
| `User` | id, name, email, role, segment, region, teamId, pushToken?, prefsJson |
| `Session` | id, userId, channel (APP/PHONE), createdAt, expiresAt |
| `VoiceSession` | id, userId, mode (DEBRIEF/BRIEF/ASK/DEAL/LIVE), state, accountId?, meetingId?, startedAt, endedAt? |
| `TranscriptSegment` | id, voiceSessionId, speaker (RM/AGENT), text, startedAt, final:boolean |
| `DebriefDraft` | id, voiceSessionId, userId, accountId, meetingId?, status, draftJson, updatedAt |
| `Debrief` | id, draftId, userId, accountId, salesforceId, transcriptRef, confirmedAt, modelVersion |
| `WriteIntent` | id, userId, kind, payloadJson, approvalsRequiredJson, status (PENDING/EXECUTED/EXPIRED/FAILED), expiresAt |
| `AuditEvent` | id, at, userId, action, targetSystem, targetObject, targetId?, intentId?, confirmationJson?, beforeJson?, afterJson?, requestId |
| `FollowUpDraft` | id, debriefId, kind (CLIENT/INTERNAL), toJson, subject, body, guardResultJson, editedBody?, mailDraftId?, status |
| `Alert` | fields per type + dedupeKey (unique on rule+facilityId while open) |
| `Referral` | per type + salesforceId |
| `DealDraft` | per type |
| `DocumentRequest` | id, accountId, itemsJson, mailDraftId?, reminderScheduleJson |
| `TalkingPointFeedback` | id, userId, accountId, ruleId, feedback, at |
| `CoveragePlan` | id, userId, weekOf, itemsJson |
| `HealthScoreSnapshot` | id, accountId, score, band, driversJson, computedAt |
| `ConsentRecord` | id, userId, meetingId, jurisdiction, allPartyRequired, statement, confirmedAt (F11) |
| `PricingView` | id, userId, dealId, inputsJson, outputJson, at (F12 audit) |
| `Notification` | id, userId, type, title, body, deepLink, sentAt?, suppressedReason?, readAt? |
| `CachedBrief` | meetingId/accountId, briefJson, expiresAt |

Mock external tables (`mock_*`): `mock_sf_account`, `mock_sf_contact`, `mock_sf_event`, `mock_sf_task`, `mock_sf_opportunity`, `mock_sf_case`, `mock_sf_debrief`, `mock_sf_debrief_attendee`, `mock_sf_referral`, `mock_ncino_loan`, `mock_ncino_covenant`, `mock_ncino_tickler`, `mock_ncino_draft_request`, `mock_ncino_spread`, `mock_acbs_balance_history`, `mock_deposit_balance_history`, `mock_deposit_product`, `mock_pl_profitability`, `mock_news`, `mock_kyc_requirement`, `mock_mail_draft`, `mock_calendar_hold`, `mock_call_log` (adapter, method, argsJson, at).

## 3. Salesforce mapping (standard Sales Cloud)

### `Meeting_Debrief__c` (custom)

| Field | Type | From |
|---|---|---|
| `Account__c` | Lookup(Account), required | draft.accountId |
| `Event_Id__c` | Text(18) | draft.meetingId |
| `Meeting_Date__c` | DateTime | meeting.start |
| `Meeting_Type__c` | Picklist | draft.meetingType |
| `Purpose__c` | Picklist | draft.purpose |
| `Summary__c` | Long Text | draft.summary |
| `Client_Needs__c` | Long Text | draft.clientNeeds |
| `Risk_Signals__c` | Long Text | draft.riskSignals |
| `Risk_Flag__c` | Checkbox | flags.risk.flagged |
| `Complaint_Flag__c` | Checkbox | flags.complaint.flagged |
| `MNPI_Flag__c` | Checkbox | flags.mnpi.flagged |
| `Specialist_Interest__c` | Multi-select | draft.specialistInterest |
| `Source__c` | Picklist (Phone/App/Chat/Manual) | session channel |
| `Transcript_Ref__c` | Text(255) | ArchiveAdapter ref |
| `Confirmed_By__c` | Lookup(User) | confirmation.confirmedBy |
| `Confirmed_At__c` | DateTime | now |
| `Model_Version__c` | Text(80) | config model names + prompt version |

### `Debrief_Attendee__c` (junction)

`Debrief__c` (Master-Detail), `Contact__c`, `User__c`, `Role__c`.

### `Referral__c` (custom, F05)

`Account__c`, `Contact__c`, `Specialty__c`, `Need_Summary__c`, `Urgency__c`, `Routed_Queue__c`, `Routed_User__c`, `Status__c`, `Consent_To_Share__c`, `Debrief__c`.

### Standard objects

| Object | Writes |
|---|---|
| Task | `Subject`, `WhatId` (Account/Opportunity), `WhoId` (Contact), `OwnerId`, `ActivityDate`, `Status`, custom `Debrief__c`, custom `Client_Commitment__c` (Checkbox) |
| Opportunity | New: `Name` ("{Account} – {Product}"), `AccountId`, `Amount`, `CloseDate` (end of quarter), `StageName`='Prospecting', `LeadSource`='Sherpa'. Update: Stage/Amount/CloseDate/NextStep — approval required |
| Contact | Create or update `Title`, `Email` — approval required |
| Event | Append short summary to `Description`; custom `Debrief__c` lookup |
| Case | Complaint: `RecordType`='Complaint', `AccountId`, `ContactId`, `Subject`, `Description`, `Origin`='Sherpa', routed to complaints queue |
