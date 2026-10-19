# Sherpa

AI assistant for Commercial and Small Business relationship managers. RMs talk to Sherpa (voice or chat) to prep for meetings, debrief afterwards, draft follow-ups and track what they promised clients. Sherpa writes to systems of record only after the RM confirms.

> *Sherpa carries the load, so our RMs can focus on the climb.*

**This build uses synthetic data only.** Do not send real client data to the public OpenAI API. See `docs/08-compliance-controls.md`.

## Quick start

Requirements: Node 20+ (22 recommended), pnpm 10+, Xcode with an iOS simulator (or the Expo Go app on a phone).

```bash
pnpm install
cp .env.example .env        # mock mode by default; no keys needed
pnpm db:reset               # create the SQLite DB and load the synthetic seed
pnpm dev                    # API on :4000 + Expo
```

Then press `i` in the Expo terminal (or run `pnpm --filter @sherpa/mobile ios`) to open the app in the iOS simulator through Expo Go. Sign in as **Maya Chen** — Today shows the pending Acme debrief.

The phone talks only to the Sherpa server. On a physical phone, keep it on the same Wi-Fi; the app finds the server from the Expo host address (override with `EXPO_PUBLIC_API_URL`).

### Modes

| Variable | `mock` (default) | `openai` |
|---|---|---|
| `LLM_MODE` | Deterministic rule-based extraction, drafting and phrasing | OpenAI chat with strict JSON-schema outputs; falls back to rules on error |
| `VOICE_MODE` | Server sends text; the phone speaks it on-device. Type, or tap a "Try saying" reply | OpenAI transcription + streamed TTS; talk into the mic |
| `INTEGRATIONS_MODE` | All systems mocked in the `mock_*` tables | `live` skeletons (fails fast without credentials) |

For OpenAI mode set `OPENAI_API_KEY` and the model names in `.env` (model names are config, never code):

```
LLM_MODE=openai
VOICE_MODE=openai
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=sage
```

The key stays on the server. `.env` is git-ignored.

### The demo clock

By default (`CLOCK_MODE=demo`) the server clock starts at **3:30 PM on the seed day** whenever it boots, so the story is always the same: the 2 PM Acme annual review has ended (debrief pending) and the 4 PM Harbor renewal is coming up. Set `SEED_TODAY=2026-10-19` for a fixed date, or `CLOCK_MODE=real` for the wall clock.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Server (watch) + Expo together |
| `pnpm dev:server` / `pnpm dev:mobile` | One side only |
| `pnpm db:reset` | Sync the schema and reload the deterministic seed |
| `pnpm test` | Unit, integration, contract and eval-regression tests (mock mode, no network) |
| `pnpm evals` | Extraction eval report on 20 golden debriefs (`--mode openai`, `--case G1`) → `packages/evals/reports/` |
| `pnpm test:e2e` | Maestro flows in `apps/mobile/.maestro` (needs Maestro and a running simulator) |
| `pnpm lint`, `pnpm typecheck` | ESLint (incl. the C-07 "no mail send" rule) and TypeScript strict |

## Repository

```
apps/mobile        Expo + React Native app (expo-router)
apps/server        Fastify API, voice WebSocket gateway, WriteGateway, scheduler
packages/shared    Domain types + zod schemas (single source of truth for API shapes)
packages/agent     Orchestrator state machines, guardrails, extraction, prompts, speech formatting, tools
packages/adapters  Integration interfaces, mock implementations, live skeletons, OpenAI LLM/voice providers
packages/db        Prisma schema (Sherpa + mock_* tables) and the synthetic seed
packages/evals     Golden debriefs and the eval harness
docs/              The build spec; docs/DECISIONS.md records every open choice
```

## What is built

All 13 features (F01–F13) across milestones M0–M9. F11 live listening, F12 pricing guidance and F13 health scoring are built but **off**: they need `enabled: true` **and** `complianceApproved: true` (F13 also `modelValidated: true`) in `config/features.json`. While off, their routes return 404 and their UI is hidden.

Product rules are enforced in code and covered by tests:

- **Human in the loop:** every external write goes through `WriteGateway` (intent → confirmation by the same RM within 15 minutes → audited execution). Opportunities need their own explicit approval.
- **Never auto-send:** `MailAdapter` has no send method; a lint rule and a static test enforce it.
- **Complaints can't be suppressed:** the flag is locked (API returns 409) and a Case is routed on save.
- **Entitlements:** every read and write is filtered by the signed-in RM's book.
- **No audio storage:** audio is buffered in memory per utterance and discarded after transcription.
- **Sourced facts:** every brief fact carries its source and as-of date; Q&A answers "I don't have that" otherwise.

## What is mocked

Salesforce, nCino, ACBS, core deposits, PrecisionLender, Microsoft 365 calendar and mail, news, KYC, push, transcript archive, telephony and the event bus are all mock adapters with real interfaces. Live adapter skeletons for Salesforce (REST + composite), Microsoft Graph, nCino, ACBS, core deposits and PrecisionLender are in `packages/adapters/src/live`, with contract tests against recorded fixtures. Phone channel auth (PIN or push approval) is implemented; the phone line itself is a mock harness (`POST /v1/dev/telephony/inbound`).

## Testing notes

- Server tests use a separate SQLite file (`packages/db/prisma/test.db`) and a manual clock fixed at Monday 2026-10-19 15:30.
- Test names reference requirement IDs (`F01-AC3`, `C-07`, …).
- Evals: mock mode must stay at 100% on every metric (CI fails otherwise). OpenAI mode last measured at 100% on all 10 metrics with `gpt-4.1-mini`.
