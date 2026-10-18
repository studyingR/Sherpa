# 04 — API Contract

Base URL `/v1`. JSON over HTTPS. Auth: `Authorization: Bearer <session JWT>`. All request/response bodies are defined as zod schemas in `packages/shared/src/schemas` with the names below; the mobile API client is typed from them.

Errors: `{ error: { code: string, message: string, details?: unknown } }` with HTTP status. Common codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403 (entitlement), `NOT_FOUND` 404 (also for inactive features), `CONFLICT` 409 (e.g. attempting to clear complaint flag, expired intent), `VALIDATION` 422, `UPSTREAM_UNAVAILABLE` 503.

## 1. Auth and profile

| Method | Path | Body / Query | Response | Notes |
|---|---|---|---|---|
| GET | `/auth/personas` | — | `Persona[]` | dev/mock only |
| POST | `/auth/sign-in` | `{ personaId }` | `{ token, user }` | mock SSO |
| POST | `/auth/phone/verify` | `{ sessionId, pin? }` | `{ ok }` | phone channel (mock) |
| GET | `/me` | — | `User` | |
| GET | `/me/features` | — | `Record<FlagName, boolean>` | resolved active flags |
| GET/PUT | `/me/preferences` | `Preferences` | `Preferences` | nudges, privacy mode, voice speed |
| POST | `/me/push-token` | `{ token }` | `{ ok }` | |

## 2. Today and accounts

| Method | Path | Response | Feature |
|---|---|---|---|
| GET | `/today` | `TodayView` = `{ greeting, pendingDebriefs[], meetings[] (with briefStatus), commitmentsDue[], overdueTasks[], alerts[], documentsDue[], coverageSuggestions[], atRisk[]? }` | F04 (+F06, F08, F10, F13) |
| GET | `/accounts?query=&segment=` | `AccountSummary[]` (my book only) | |
| GET | `/accounts/:id` | `AccountDetail` (overview, contacts, recent debriefs, tasks, alerts, referrals, documents, talkingPoints, health?) | |
| GET | `/meetings?from=&to=` | `Meeting[]` | |

## 3. Debrief (F01)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/debriefs/sessions` | `{ meetingId?, accountId?, channel: 'APP'|'CHAT' }` | `{ sessionId, draftId, proposedMeeting, resumeOf? }` |
| GET | `/debriefs/drafts/:draftId` | — | `DebriefDraft` |
| PATCH | `/debriefs/drafts/:draftId` | `DebriefDraftPatch` (edits, include toggles, approvals, specialist chips) | `DebriefDraft` — 409 if patch tries to unset `flags.complaint.flagged` |
| POST | `/debriefs/drafts/:draftId/chat` | `{ text }` | `AgentTurn` (chat mode) |
| POST | `/debriefs/drafts/:draftId/intent` | — | `WriteIntent` (what will be written, approvals required) |
| POST | `/debriefs/confirm` | `Confirmation` | `WriteResult` = `{ debriefId, written: WrittenItem[], held: HeldItem[] }` |
| GET | `/debriefs/:id` | — | `DebriefDetail` |
| GET | `/debriefs/resumable` | — | `DebriefDraft[]` |

## 4. Brief (F02)

| Method | Path | Response |
|---|---|---|
| GET | `/briefs/meeting/:meetingId` | `Brief` |
| GET | `/briefs/account/:accountId` | `Brief` |
| POST | `/briefs/:accountId/ask` | `{ question }` → `{ answer, facts: SourcedFact[] }` |

## 5. Follow-up drafts (F03)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/debriefs/:id/drafts` | `{ kinds: ('CLIENT'|'INTERNAL')[] }` | `FollowUpDraft[]` (with `guardResult`) |
| PATCH | `/drafts/:draftId` | `{ subject?, body? }` | `FollowUpDraft` (guard re-run) |
| POST | `/drafts/:draftId/save-to-mailbox` | `Confirmation` | `{ mailDraftId }` |

There is intentionally **no** send endpoint.

## 6. Tasks and nudges (F04)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/tasks?status=&commitment=` | — | `Task[]` |
| POST | `/tasks/:id/intent` | `{ action: 'COMPLETE'|'RESCHEDULE'|'DELEGATE', dueDate?, delegateTo? }` | `WriteIntent` |
| POST | `/tasks/confirm` | `Confirmation` | `WriteResult` |
| GET | `/agenda` | — | `{ spoken: string, view: TodayView }` |

## 7. Referrals (F05)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/referrals?accountId=` | — | `Referral[]` |
| POST | `/referrals/intent` | `{ accountId, specialty, contactId?, needSummary, urgency, consentToShare }` | `WriteIntent` (with resolved route) |
| POST | `/referrals/confirm` | `Confirmation` | `WriteResult` |

## 8. Alerts (F06)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/alerts?status=` | — | `Alert[]` |
| POST | `/alerts/:id/action` | `{ action: 'ACK'|'SNOOZE'|'DISMISS'|'CREATE_TASK', snoozeDays?, reason? }` | `Alert` (CREATE_TASK returns a `WriteIntent`) |
| POST | `/alerts/refresh` | — | `{ created, updated }` (dev/on-demand) |

## 9. Deals (F07)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/deals/sessions` | `{ accountId, fromDebriefId? }` | `{ sessionId, dealDraftId }` |
| GET/PATCH | `/deals/:id` | `DealDraftPatch` | `DealDraft` |
| POST | `/deals/:id/intent` | — | `WriteIntent` (nCino draft + optional opportunity approval) |
| POST | `/deals/confirm` | `Confirmation` | `WriteResult` |

## 10. Documents (F08)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/documents?accountId=` | — | `DocumentItem[]` |
| POST | `/documents/:accountId/request-draft` | `{ itemIds, reminderDays?: number[] }` | `FollowUpDraft` |
| POST | `/documents/:itemId/mark` | `{ status: 'RECEIVED'|'WAIVED' }` | `DocumentItem` |

## 11. Talking points (F09)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/accounts/:id/talking-points` | — | `TalkingPoint[]` |
| POST | `/talking-points/:id/feedback` | `{ feedback: 'UP'|'DOWN' }` | `{ ok }` |

## 12. Coverage (F10)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/coverage` | — | `{ items: CoverageItem[], plan: CoveragePlan }` |
| POST | `/coverage/:accountId/action` | `{ action: 'ACCEPT'|'SKIP'|'SCHEDULE', reason?, slot? }` | `WriteIntent` or `{ ok }` |
| GET | `/coverage/team` | — | `{ rmId, name, coveragePct }[]` (LEADER only) |

## 13. Gated features (404 unless active)

| Method | Path | Body | Response | Feature |
|---|---|---|---|---|
| POST | `/live/sessions` | `{ meetingId, jurisdiction, allPartyConsentConfirmed: boolean, consentStatement }` | `{ sessionId }` or 422 `CONSENT_REQUIRED` | F11 |
| POST | `/live/sessions/:id/stop` | — | `{ draftId }` → continues in F01 review | F11 |
| POST | `/pricing/guidance` | `{ dealId }` | `PricingGuidance` | F12 |
| GET | `/health-scores?band=` | — | `HealthScore[]` | F13 |
| GET | `/accounts/:id/health` | — | `HealthScore & { history }` | F13 |

## 14. Compliance queue (role COMPLIANCE)

| Method | Path | Response |
|---|---|---|
| GET | `/compliance/queue?type=COMPLAINT|MNPI|SENSITIVE` | flagged items with excerpt and links |
| POST | `/compliance/queue/:id/resolve` | `{ note }` → audit |

## 15. Ask Sherpa (global)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/ask` | `{ text, context?: { accountId?, screen? } }` | `AgentTurn` = `{ messages: AgentMessage[], actions: UiAction[], intent?: WriteIntent }` |

`UiAction` lets the agent navigate the app: `{ type: 'NAVIGATE', route }`, `{ type: 'SHOW_INTENT', intentId }`, `{ type: 'OPEN_BRIEF', meetingId }`.

## 16. Voice WebSocket

`wss://<host>/v1/voice?token=<jwt>`

Client → server messages:

```ts
type ClientMsg =
  | { type: 'start'; mode: 'DEBRIEF'|'BRIEF'|'ASK'|'DEAL'|'AGENDA'|'LIVE'; meetingId?: string; accountId?: string; resumeDraftId?: string; audio: { format: 'pcm16'; sampleRate: 16000 } }
  | { type: 'audio'; seq: number; data: string }        // base64 PCM16 chunk, ~100 ms
  | { type: 'end_of_speech' }                           // client VAD or "Done talking"
  | { type: 'text'; text: string }                      // typed input in voice session
  | { type: 'barge_in' }                                // RM interrupts TTS
  | { type: 'confirm'; confirmation: Confirmation }
  | { type: 'stop' };
```

Server → client messages:

```ts
type ServerMsg =
  | { type: 'session'; sessionId: string; draftId?: string }
  | { type: 'transcript'; speaker: 'RM'|'AGENT'; text: string; final: boolean }
  | { type: 'agent_audio'; seq: number; data: string; format: 'pcm16'|'mp3' }
  | { type: 'agent_audio_end' }
  | { type: 'draft_update'; draft: DebriefDraft | DealDraft }
  | { type: 'flag'; flag: 'COMPLAINT'|'MNPI'|'SENSITIVE'; message: string }
  | { type: 'intent'; intent: WriteIntent }
  | { type: 'write_result'; result: WriteResult }
  | { type: 'ui_action'; action: UiAction }
  | { type: 'state'; state: VoiceState }
  | { type: 'error'; code: string; message: string };
```

Heartbeat: server pings every 15 s; client reconnects with `resumeDraftId` on drop.
