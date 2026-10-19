# 09 — Build Plan

Build one milestone at a time. Each milestone must meet its acceptance criteria and the Definition of Done in `CLAUDE.md` before starting the next. Milestones are ordered so the app is runnable and demoable after each one.

| Milestone | Theme | Features |
|---|---|---|
| M0 | Foundations | Monorepo, config, auth, DB, seed, adapters (mock), design system, navigation shell |
| M1 | Debrief (chat) | F01 end to end in chat mode + WriteGateway + audit + guardrails |
| M2 | Voice | Voice gateway, mock + OpenAI pipelines, F01 in voice |
| M3 | Brief + drafts | F02, F03 |
| M4 | Today + nudges | F04, push, scheduler |
| M5 | Tier 2 | F05, F06, F07 |
| M6 | Tier 3 | F08, F09, F10 |
| M7 | Tier 4 (gated) | F11, F12, F13 behind flags; compliance queue |
| M8 | Hardening | Offline, accessibility, dark mode, performance, telephony mock, evals ≥ targets |
| M9 | Live-adapter readiness | Live adapter skeletons, contract tests, staging config |

---

## M0 — Foundations

**Scope**
- pnpm + Turborepo monorepo per `CLAUDE.md`; TypeScript strict; ESLint + Prettier; Vitest.
- `packages/shared` with all types from `03-data-model.md` and zod schemas for M0–M1 endpoints.
- Server: Fastify, config validation, pino with redaction, health route, error format, auth (mock personas, JWT), entitlement middleware, feature flags loader + `/me/features`.
- Prisma schema for all Sherpa and `mock_*` tables; deterministic seed from `07-mock-data.md`.
- `packages/adapters`: all interfaces; mock implementations for Salesforce, Calendar, nCino, ACBS, CoreDeposits, PrecisionLender, News, Mail, KYC, Push, Identity, Archive; `mock_call_log`.
- Mobile: Expo app, fonts, tokens, components (Card, Button, Chip, Badge, ListRow, SectionLabel, FlagBanner, SourceTag, Skeleton), tab navigation, sign-in with persona picker, Today screen (static from `/today` mock), Accounts list/detail (read-only).

**Acceptance**
- `pnpm dev` starts server and Expo; sign in as Maya shows Today with seeded meetings and commitments.
- Maya cannot fetch Devon's account (403 test).
- Inactive features return 404 (F11–F13).
- Seed is deterministic with `SEED_TODAY`.

## M1 — Debrief in chat (F01)

**Scope**
- `packages/agent`: orchestrator, `MockLlmProvider`, `OpenAiLlmProvider` (chat + structured outputs), debrief prompts, extraction + post-processing (dates, amounts, owners), guardrails (complaint, MNPI, sensitive, commitment, internal-only) with tests.
- `WriteGateway` + `WriteIntent` + `Confirmation` + audit.
- Debrief endpoints (sessions, drafts, patch, chat, intent, confirm, resumable).
- Mobile: chat-mode debrief screen, review screen, saved screen (as prototype).

**Acceptance**
- F01-AC1…AC7 in chat mode (AC6 via app restart).
- Golden G1–G8 pass in mock mode.
- C-01, C-02, C-03, C-04, C-05, C-18 tests pass.

## M2 — Voice (F01 voice)

**Scope**
- Voice WebSocket (`04-api-contract.md` §16), session state machine, heartbeat, resume.
- `MockVoiceProvider`; `OpenAiVoiceProvider` (stt-tts pipeline: transcription + TTS streaming); barge-in.
- Mobile: recorder (PCM16 16 kHz), client VAD (energy threshold + 2.5 s silence), player, call screen with states, captions.
- Speech formatting and privacy mode.

**Acceptance**
- Full G1 flow runs by voice in mock mode (text-as-speech) and, with `OPENAI_API_KEY` set, with real speech on a device.
- No audio persisted (C-10 test).
- Reconnect mid-call resumes the draft.

## M3 — Brief and follow-up drafts (F02, F03)

**Scope**: BriefService (parallel reads, timeouts, sourced facts, missing sources, cache), spoken rendering, brief screen, Q&A; follow-up drafting with guards, drafts screen, save to mailbox (mock).

**Acceptance**: F02-AC1…AC5 (AC5 can be verified in M4 with the scheduler), F03-AC1…AC3; C-06, C-07, C-09.

## M4 — Today, tasks and nudges (F04)

**Scope**: Today aggregation, agenda (spoken), task actions via intents (complete/reschedule/delegate), push (Expo push in dev + mock adapter), scheduler (node-cron): morning agenda, brief-ready pushes 30 min before meetings, quiet hours, dedupe; notification center; settings.

**Acceptance**: F04-AC1…AC3; F02-AC5.

## M5 — Tier 2 (F05, F06, F07)

**Scope**: Referral routing rules + screens; alert rules engine + nightly job + alerts tab + actions + snooze; deal intake mode (voice/chat), deal review, nCino draft creation (mock), opportunity link, `deal.draft_created` event.

**Acceptance**: F05-AC1…AC2, F06-AC1…AC2, F07-AC1…AC2.

## M6 — Tier 3 (F08, F09, F10)

**Scope**: Document items from ticklers + KYC; request drafting with reminders; product-gap rules + LLM phrasing + feedback; coverage engine, weekly plan, actions, leader team view.

**Acceptance**: F08-AC1…AC2, F09-AC1…AC2, F10-AC1…AC2.

## M7 — Tier 4, gated (F11, F12, F13) + compliance queue

**Scope**: Live listening with consent flow; pricing guidance screen + audit; health scorecard + history + allowlist; compliance queue + audit query for COMPLIANCE role. All behind flags; verify they are invisible when inactive.

**Acceptance**: F11-AC1…AC2, F12-AC1…AC2, F13-AC1…AC2; C-15, C-16, C-17. With flags off, no UI or routes are reachable (E2E).

## M8 — Hardening

**Scope**: Offline read cache + draft queue; accessibility audit (labels, dynamic type, contrast); dark mode tokens; performance budgets; error/empty states everywhere; `TelephonyAdapter` mock harness (simulated inbound call that runs the same voice session); eval harness reporting.

**Acceptance**: Eval targets met (`10-testing-and-evals.md`); Maestro suite green; performance targets in `02-architecture.md` §9 met in mock mode.

## M9 — Live-adapter readiness

**Scope**: `live/` adapter skeletons for Salesforce (REST + composite API), Microsoft Graph (calendar, mail drafts), nCino, ACBS, CoreDeposits, PrecisionLender with typed request/response mapping and contract tests against recorded fixtures; `LlmProvider` gateway variant (configurable base URL + headers); staging config template. No real credentials in repo.

**Acceptance**: Contract tests pass against fixtures; switching `INTEGRATIONS_MODE=live` without credentials fails fast with a clear message.
