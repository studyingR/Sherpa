# 10 — Testing and Evals

## 1. Test layers

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Parsers (dates, amounts), guardrails, speech formatter, rules engines (alerts, coverage, product gaps, health), WriteGateway, feature-flag resolution |
| Integration | Vitest + Fastify inject | Routes with mock adapters and SQLite in-memory; entitlement checks; audit completeness; WS voice sessions with `MockVoiceProvider` |
| Contract (M9) | Vitest | Live adapter mapping against recorded fixtures |
| E2E mobile | Maestro | Flows below on iOS simulator / Android emulator against the dev server in mock mode |
| Evals | `packages/evals` | LLM extraction quality on golden debriefs (mock and openai modes) |

Name tests with requirement IDs, e.g. `it('F01-AC3 holds unapproved opportunity')`.

## 2. Required E2E flows (Maestro)

1. Sign in as Maya → Today shows Acme pending debrief.
2. Debrief (chat mode) G1 → review → approve opportunity → confirm → saved shows 3 tasks, opportunity created, complaint routed.
3. Debrief G2 → saved shows "Held · not approved".
4. Saved → Draft recap → guard passes → Save to Outlook drafts → "not sent" state.
5. Open Harbor brief → sections render with source tags → privacy toggle works.
6. Today → mark Brightwater commitment done → confirm → disappears from due list.
7. Alerts → snooze Castell breach risk → moves to Snoozed.
8. Referral from Acme debrief → FX → routed queue shown → confirm.
9. Deal intake for Acme → draft created label "not submitted".
10. Documents for Castell → draft request.
11. Coverage plan → accept Northgate → task created.
12. With F11–F13 flags off: no Live, Pricing or Health UI anywhere.
13. With F11–F13 flags on (test config): consent required for live; pricing disclaimer visible; health band shown.

## 3. Eval harness

`pnpm evals [--mode mock|openai] [--case G1]`

For each golden case: run the scripted turns through the orchestrator, compare the resulting draft to `expected` with field-level scoring:

| Metric | Definition | Target (openai mode) |
|---|---|---|
| Next-step recall | expected next steps matched (fuzzy title ≥ 0.8 similarity, owner match) | ≥ 95% |
| Next-step precision | extracted steps that match an expected one | ≥ 90% |
| Due-date accuracy | exact ISO match | ≥ 95% |
| Amount accuracy | exact numeric match | 100% |
| Complaint recall | flagged when expected | 100% |
| Complaint false-positive rate | flagged when not expected | ≤ 5% |
| MNPI recall | | 100% |
| Specialist interest F1 | | ≥ 0.9 |
| Gap questions ≤ 3 | | 100% |
| Read-back length | ≤ 110 words | 100% |

Output a markdown report to `packages/evals/reports/<timestamp>.md` and fail CI (mock mode) if any mock-mode case regresses.

## 4. CI

GitHub Actions workflow: install → typecheck → lint → unit/integration → evals (mock) → build mobile (Expo prebuild check). Maestro E2E runs on demand or nightly.
