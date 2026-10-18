# 08 — Compliance, Risk and Controls

This doc turns the controls agreed in the roadmap into concrete implementation requirements. Each control has an ID (`C-xx`) and at least one automated test.

## 1. Controls → implementation

| ID | Risk | Control (implementation requirement) | Test |
|---|---|---|---|
| C-01 | Inaccurate notes written to CRM | All external writes go through `WriteGateway`; require `Confirmation` from the same RM within 15 min of intent | Unit: execute without confirmation throws; expired intent → 409 |
| C-02 | Unapproved pipeline changes | Opportunity create/update only when the specific approval item is `true` | Unit + E2E (G2) |
| C-03 | Missed complaints | Complaint detector (pattern + LLM, OR'd); flag locked; Case created on save regardless of approvals | Unit (G1, G3), API 409 on unflag attempt |
| C-04 | MNPI in notes | MNPI flag → compliance queue item; MNPI excerpt excluded from all drafts | Unit (G4) |
| C-05 | Sensitive attributes in records | Detector prompts removal before save; if kept, flagged to compliance | Unit (G8) |
| C-06 | Implied commitments to clients | Commitment guard on all client-facing text; no rates/approval words survive | Unit with injected phrases |
| C-07 | Auto-sent communications | `MailAdapter` has no send method; lint rule forbids `send(` on mail adapter; no send route | Static test |
| C-08 | Unauthorized data access | Entitlement middleware on every route; service-level filter by book; tests for cross-RM access | Integration: Maya cannot read Devon's accounts (403) |
| C-09 | Sensitive data spoken aloud | Privacy mode default on in voice; figures replaced unless RM consents per session | Unit on speech formatter |
| C-10 | Audio retention | No audio written to disk/DB; buffers cleared after transcription; test asserts no audio files created | Integration |
| C-11 | Communications retention | Transcripts stored via `ArchiveAdapter` with ref on debrief; retention period configurable | Unit |
| C-12 | Account takeover via phone | Phone channel requires push approval or PIN; caller ID alone rejected | Unit |
| C-13 | PII to external LLM | `PiiScrubber` before every LLM call in openai mode; synthetic data only in dev | Unit: emails/phones/account numbers tokenized |
| C-14 | Prompt injection from external text | External text wrapped as data; system prompt rule; tool calls from injected text rejected | Unit with injected news item |
| C-15 | Live recording consent (F11) | Feature gated; consent record required; all-party-consent jurisdictions block without confirmation | Unit + API 422 |
| C-16 | Pricing misuse (F12) | Gated; screen-only; every view audited; never in drafts | Unit + audit count |
| C-17 | Model risk / fairness (F13) | Gated; rules-based scorecard; input allowlist excludes protected attributes and proxies; disclaimer shown | Unit: allowlist test |
| C-18 | Traceability | `Model_Version__c` = model names + prompt version on every debrief; audit for every external write | Integration: 100% writes audited |
| C-19 | Logging leakage | pino redaction for transcript, email bodies, contact details | Unit on logger |

## 2. Audit log

Every external write and every gated-feature access writes an `AuditEvent`:

- who (`rmId`), when, action, target system/object/id, intent id, confirmation (channel + utterance), before/after snapshot, request id.
- Audit events are append-only (no update/delete routes; DB constraint or service-level guard).
- Compliance role can query audit events by account or RM via `/v1/compliance/audit?accountId=` (read-only).

## 3. Compliance review queue

Items created by complaint, MNPI and kept-sensitive flags. Each item: type, account, RM, excerpt (minimal necessary), debrief link, created at, status (OPEN/RESOLVED), resolver note. Complaint items also hold the created Case id.

## 4. Gated feature enablement checklist (to record in `config/features.json` change PRs)

- F11: Legal confirmation of jurisdiction consent list; recordkeeping approach; supervision procedure; Compliance sign-off → set `complianceApproved: true`.
- F12: Pricing authority matrix confirmed; disclaimer approved; Compliance sign-off.
- F13: Model risk validation of scorecard; fair lending review of inputs; Compliance sign-off → `complianceApproved` and `modelValidated` true.

## 5. Governance before any real data

- Register Sherpa as a use case with Model Risk Management.
- Privacy impact assessment.
- Route LLM traffic through the bank's approved endpoint/gateway (replace direct OpenAI calls via `LlmProvider` config).
- Information Security review of mobile app, voice channel and adapters.
- Compliance sign-off on complaint and MNPI handling.
