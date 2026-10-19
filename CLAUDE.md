# CLAUDE.md — Sherpa

You are building **Sherpa**, a mobile AI assistant for bank relationship managers (RMs). The full spec is in `docs/`. Read the relevant docs before each task. When the docs and this file disagree, this file wins; when a doc is silent, choose the simplest option that keeps the product rules below and note it in `docs/DECISIONS.md`.

## Product rules (non-negotiable)

1. **Human in the loop.** Nothing is written to a system of record (Salesforce, nCino, etc.) without an explicit RM confirmation captured in the audit log. Opportunity creation and any change to Opportunity Stage, Amount or CloseDate require their own explicit approval.
2. **Never auto-send to clients.** Client-facing emails are created as drafts only.
3. **Complaints cannot be suppressed.** If the complaint detector flags content, the complaint is logged and routed on save. The RM cannot remove the flag in the UI or API.
4. **Entitlements.** Every data read and write is performed as the signed-in RM and filtered by their book of business. No cross-RM data leakage.
5. **No audio storage.** Audio is streamed, transcribed and discarded. Only transcripts are persisted.
6. **Sourced facts only.** Briefs and insights show each fact's source system and as-of date. The agent must not invent figures; when data is missing it says so.
7. **Regulated features are gated.** F11 (live listening), F12 (pricing guidance) and F13 (relationship health scoring) are built behind feature flags that default to `false` and also require `complianceApproved: true` in config before they can be enabled.
8. **Synthetic data only** in dev and test. Never commit real names, account numbers or keys.

## Stack

- Monorepo with **pnpm workspaces** and **Turborepo**.
- `apps/mobile`: **Expo (SDK latest stable) + React Native + TypeScript**, `expo-router` for navigation, `@tanstack/react-query` for server state, `zustand` for local UI state, `expo-audio` (or `expo-av` if needed) for recording and playback, `expo-secure-store` for tokens, `expo-notifications` for push.
- `apps/server`: **Node 20+, TypeScript, Fastify**, `zod` for validation, **Prisma** (SQLite dev, Postgres prod), `ws` for WebSockets, `pino` logging, `openai` official SDK.
- `packages/shared`: domain types and zod schemas shared by mobile and server (single source of truth for API shapes).
- `packages/agent`: agent orchestrator, tools, prompts, guardrails and extraction schemas (imported by the server).
- `packages/adapters`: integration interfaces plus `mock` implementations (Salesforce, nCino, ACBS, CoreDeposits, PrecisionLender, Calendar, Mail, News, Telephony, Identity, LLM, Voice).
- Testing: **Vitest** (unit/integration), **Supertest**-style server tests, **Maestro** for mobile E2E flows.

## Repo layout

```
apps/
  mobile/            Expo app (expo-router, app/ directory)
  server/            Fastify API + WebSocket voice gateway
packages/
  shared/            types, zod schemas, constants, feature flag names
  agent/             orchestrator, tools, prompts, guardrails, extraction
  adapters/          interfaces + mock/ + (later) live/ implementations
  evals/             extraction eval harness and golden debriefs
docs/                specs (read-only unless asked; update docs/DECISIONS.md freely)
```

## Commands (create these in M0)

- `pnpm install`
- `pnpm dev` — runs server and Expo together
- `pnpm dev:server`, `pnpm dev:mobile`
- `pnpm db:reset` — reset and seed the dev database from `docs/07-mock-data.md`
- `pnpm test` — all unit and integration tests
- `pnpm test:e2e` — Maestro flows
- `pnpm evals` — run the extraction eval harness
- `pnpm lint`, `pnpm typecheck`

## Configuration

All config through environment variables validated by zod at startup (`apps/server/src/config.ts`). Key variables:

- `LLM_MODE=mock|openai` (default `mock`)
- `VOICE_MODE=mock|openai` (default `mock`)
- `OPENAI_API_KEY` (required only when a mode is `openai`)
- `OPENAI_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REALTIME_MODEL` — model names are config, never hard-coded
- `INTEGRATIONS_MODE=mock` (live adapters come later)
- `FEATURE_FLAGS_FILE=./config/features.json`

Mock modes must be deterministic so tests pass without network access or keys.

## Conventions

- TypeScript `strict: true` everywhere. No `any` without a comment explaining why.
- All API inputs and outputs validated with zod schemas from `packages/shared`.
- Every integration call goes through an adapter interface; no direct HTTP calls to external systems from routes or agent tools.
- Every write to an external system goes through `WriteGateway` (see `docs/02-architecture.md`), which enforces confirmation and writes the audit record.
- Keep functions small; colocate tests (`*.test.ts`).
- Accessibility: every touchable has an accessible label; minimum touch target 44×44pt; text contrast ≥ 4.5:1.
- Copy: plain, short, banking-appropriate. Never use emoji in the UI.

## Definition of done (every milestone)

- Acceptance criteria in `docs/09-build-plan.md` for that milestone pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; E2E flows for the milestone pass.
- New behavior has tests; guardrail logic has explicit tests for the negative cases.
- `docs/DECISIONS.md` updated with any choice the spec left open.
- A short summary of what was built, what is mocked, and what is left.
