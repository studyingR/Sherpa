# Sherpa — Build Spec Package

Sherpa is an AI virtual assistant for Commercial and Small Business relationship managers (RMs). RMs talk to it (by voice or chat) to prep for client meetings, debrief afterwards, draft follow-ups, and track what they promised clients. It writes to Salesforce only after the RM confirms.

> *Sherpa carries the load, so our RMs can focus on the climb.*

This package is written to be handed to **Claude Code** to build the app end to end.

## How to use this package with Claude Code

1. Create an empty Git repository and copy this whole folder's contents into its root (so `CLAUDE.md` sits at the repo root and the specs sit under `docs/`).
2. Open the repo in Claude Code.
3. Start with this prompt:

   > Read CLAUDE.md and every file in docs/. Then build milestone M0 from docs/09-build-plan.md. Stop when M0's acceptance criteria pass and summarize what you built.

4. Continue one milestone at a time (`Build milestone M1`, then `M2`, …). Each milestone has acceptance criteria and tests, so you can review before moving on.
5. The app runs fully on **mock data and mock services** by default. Add an OpenAI API key to `.env` to switch the agent and voice layers to live OpenAI calls (see `docs/05-agent-and-voice.md`).

## What's in the package

| File | What it covers |
|---|---|
| `CLAUDE.md` | Rules Claude Code follows on every task: stack, repo layout, commands, conventions, non-negotiable product rules, definition of done |
| `docs/01-product-spec.md` | Vision, personas, and all 13 features (F01–F13) with user stories, functional requirements and acceptance criteria |
| `docs/02-architecture.md` | System architecture, monorepo layout, adapters, configuration, security model, key sequence flows |
| `docs/03-data-model.md` | Domain types, database schema, Salesforce object mapping |
| `docs/04-api-contract.md` | REST and WebSocket API between the mobile app and the server |
| `docs/05-agent-and-voice.md` | Agent orchestrator, OpenAI usage, tools, prompts, extraction schemas, guardrails, voice call state machine |
| `docs/06-mobile-ux.md` | Screens, navigation, design tokens, components, accessibility |
| `docs/07-mock-data.md` | Synthetic seed data: RMs, clients, loans, deposits, meetings, scripted debriefs |
| `docs/08-compliance-controls.md` | Controls mapped to implementation requirements, audit log, feature-flag gating for regulated features |
| `docs/09-build-plan.md` | Milestones M0–M9 with scope, acceptance criteria and tests |
| `docs/10-testing-and-evals.md` | Unit, integration, end-to-end tests, and the LLM extraction eval harness |

## Key decisions already made

- **Mobile:** React Native + Expo (TypeScript), iOS and Android from one codebase.
- **Server:** Node.js + TypeScript (Fastify), Prisma ORM (SQLite in dev, Postgres in prod).
- **AI:** OpenAI API via the user's API key, behind a provider interface so it can be routed through the enterprise LLM gateway later.
- **Integrations:** Salesforce (standard Sales Cloud), nCino, ACBS, core deposits, PrecisionLender, Microsoft 365 (calendar, Outlook), telephony. All mocked behind real interfaces in the first build.
- **Retention:** transcripts only; audio is never stored.
- **Scope:** all 13 features. Tier 4 features (F11–F13) are built but ship **disabled** behind compliance feature flags.

## Important before using real data

The first build uses synthetic data only. Do **not** send real client data to the public OpenAI API. Production use must go through the bank's approved LLM endpoint or gateway, with Information Security, Privacy and Model Risk Management sign-off. See `docs/08-compliance-controls.md`.
