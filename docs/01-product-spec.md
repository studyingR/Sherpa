# 01 — Product Spec

## 1. Vision

Sherpa gives Commercial and Small Business RMs time back by handling the admin around client meetings — prep, logging, follow-up and tracking — so they can spend that time deepening client relationships.

**Principles**

- Voice-first, mobile-first: an RM should be able to do everything from the car between meetings.
- The RM is always in control: Sherpa proposes, the RM confirms.
- Sourced, honest answers: every fact has a source and an as-of date.
- Bank-grade by default: entitlements, audit, complaint capture, no audio retention.

## 2. Personas

| Persona | Description | Primary needs |
|---|---|---|
| **Commercial RM** ("Maya Chen") | Manages 40–80 middle-market relationships; complex credit and treasury | Deep prep, accurate deal capture, specialist coordination |
| **Small Business RM** ("Devon Brooks") | Manages 150–400 smaller relationships | Fast logging, proactive coverage, volume |
| **RM Analyst / Associate** ("Priya Shah") | Supports one or more RMs | Receives delegated tasks, document chasing |
| **Market / Team Leader** ("Sam Ortiz") | Manages a team of RMs | Pipeline visibility, coverage gaps (read-only views) |
| **Compliance reviewer** ("Jordan Lee") | Reviews complaint and MNPI queues | Queue of flagged items with context |

Personas in the mock data use these names. Market Leader and Compliance views are minimal web-free mobile screens in this build (see F13 and the controls doc).

## 3. Channels

- **Mobile app** (iOS and Android): primary surface. Voice mode and chat mode on every feature.
- **Dedicated phone number**: RM calls in; same agent, voice only. Implemented through a `TelephonyAdapter` (mocked in this build; the mobile app's in-app voice is the working voice channel).
- **Push notifications**: brief-ready, morning agenda, watchlist alerts, nudges.
- Teams: out of scope for this build (leave an adapter seam).

## 4. Feature catalogue

| ID | Feature | Tier | Default flag |
|---|---|---|---|
| F01 | Post-meeting voice debrief to Salesforce | 1 | on |
| F02 | On-demand meeting brief | 1 | on |
| F03 | Follow-up drafting | 1 | on |
| F04 | Next-step tracking and nudges | 1 | on |
| F05 | Specialist referral routing | 2 | on |
| F06 | Portfolio watchlist alerts | 2 | on |
| F07 | Deal intake by voice (draft nCino request) | 2 | on |
| F08 | Document chase | 3 | on |
| F09 | Talking points and next best conversation | 3 | on |
| F10 | Coverage planning | 3 | on |
| F11 | Live listening during client meetings | 4 | **off + compliance gate** |
| F12 | Pricing guidance during the conversation | 4 | **off + compliance gate** |
| F13 | Relationship health and attrition scoring | 4 | **off + compliance gate** |

Requirement IDs below use the form `F01-FR3`. Acceptance criteria use `F01-AC2`. Tests should reference these IDs.

---

## F01 — Post-meeting voice debrief to Salesforce

**Purpose:** The RM talks freely after a meeting; Sherpa turns it into a structured, confirmed Salesforce record in under three minutes.

**User stories**

- As an RM, I can start a debrief from the Today screen, a push notification, or by saying "debrief my 2 PM".
- As an RM, I can speak in my own words without being interrupted, and Sherpa asks only about what's missing.
- As an RM, I can review and correct everything on screen before it is saved.

**Functional requirements**

- F01-FR1 Meeting matching: on start, Sherpa proposes the most recent ended calendar meeting with an external attendee (from `CalendarAdapter`), showing account name, time and attendees. RM can confirm, pick another meeting, or name the client by voice. Ambiguous matches are disambiguated by account name and city.
- F01-FR2 Open floor: after confirmation, Sherpa says "Go ahead, tell me how it went" and captures RM speech until the RM pauses for ≥ 2.5 s or taps "Done talking".
- F01-FR3 Structured extraction into the `DebriefDraft` schema (`docs/05-agent-and-voice.md` §5): attendees, purpose, summary, client needs, risk signals, opportunities (product, amount, timing), next steps (title, owner, due date, client-commitment flag), specialist interest, contact updates, flags.
- F01-FR4 Gap-fill: Sherpa asks at most **3** follow-up questions, prioritized: missing next-step owner/date → opportunity amount/timing → purpose. RM can say "skip".
- F01-FR5 Required flags: the complaint detector runs on every transcript segment. If flagged, Sherpa states "I'm logging that as a complaint, per policy" and sets `complaintFlag=true` (locked). MNPI and sensitive-attribute detectors set flags for review.
- F01-FR6 Read-back: a spoken summary under 45 seconds covering summary, next steps with owners and dates, and opportunities. Amounts and dates are read in words and digits ("two point five million — 2,500,000 dollars").
- F01-FR7 Review card (mobile): summary, attendees, next steps (each toggleable include/exclude), opportunity card with explicit approve toggle, flags (complaint locked), specialist interest chips (toggleable), editable text fields.
- F01-FR8 Confirm: RM says "confirm" or taps "Confirm & save to Salesforce". `WriteGateway` creates the `Meeting_Debrief__c`, attendee junctions, Tasks (included steps only), Opportunity (only if approved), Contact updates (only if approved), updates the Event, routes the complaint, and archives the transcript reference.
- F01-FR9 "Just save it" skips the read-back but not flags or the opportunity approval (unapproved opportunities are held, not created).
- F01-FR10 Resume: a draft is autosaved every turn; if the session drops, the next debrief start offers "Resume your Acme debrief?".
- F01-FR11 Saved screen lists exactly what was written and what was held, and offers F03 ("Draft recap to Jane?").
- F01-FR12 Chat mode: the same flow works by typing.

**Acceptance criteria**

- F01-AC1 Given the scripted Acme debrief (mock data), the extracted draft matches the golden record for all required fields.
- F01-AC2 No Salesforce write occurs before confirmation (verified via mock adapter call log).
- F01-AC3 An unapproved opportunity is never created; the saved screen shows "Held · not approved".
- F01-AC4 A complaint in the transcript results in `complaintFlag=true`, a routed complaint case, and the flag cannot be cleared via UI or API (API returns 409).
- F01-AC5 Excluded next steps do not create Tasks.
- F01-AC6 Killing the app mid-debrief and restarting offers resume with all prior content intact.
- F01-AC7 Gap-fill never asks more than 3 questions.

---

## F02 — On-demand meeting brief

**Purpose:** A 90-second spoken or on-screen brief before any client meeting.

**User stories**

- As an RM, I can ask "brief me on Harbor Logistics" or tap "Brief" on a meeting.
- As an RM, I get the brief pushed 30 minutes before a scheduled client meeting.
- As an RM, I can ask follow-up questions ("When does their line mature?").

**Functional requirements**

- F02-FR1 Brief assembly pulls in parallel from: Salesforce (account, contacts, last 3 activities, open opportunities/cases/tasks), nCino/ACBS (loans: commitment, outstanding, utilization, risk rating, maturity, covenants, financials due), CoreDeposits (balances, 90-day trend, treasury products), News (last 30 days), and prior debriefs (open client commitments).
- F02-FR2 Every fact carries `source` and `asOf`. Missing sources are listed ("Deposit data unavailable right now").
- F02-FR3 Two renderings: `spoken` (≤ 90 s, ~220 words, priorities: what changed, what's due, what was promised, opportunities, risks) and `card` (sectioned, scrollable).
- F02-FR4 Privacy mode (default on in voice): Sherpa asks "Okay to read balances aloud?" before speaking exposure or balances; if no, it says "Figures are on your screen."
- F02-FR5 Push: a scheduler creates briefs 30 min before calendar meetings with external attendees and sends a push ("Harbor Logistics brief is ready").
- F02-FR6 Follow-up Q&A answers only from the assembled brief context plus permitted tool lookups; otherwise "I don't have that."
- F02-FR7 Read-only: F02 never writes to systems of record.

**Acceptance criteria**

- F02-AC1 Brief for every seeded meeting renders with all sections; each fact displays source and as-of.
- F02-AC2 With CoreDeposits mock set to fail, the brief still renders and lists the missing source.
- F02-AC3 Spoken brief text is ≤ 230 words.
- F02-AC4 An RM cannot brief an account outside their book (403).
- F02-AC5 Push is scheduled 30 ± 1 min before seeded meetings.

---

## F03 — Follow-up drafting

**Purpose:** Turn a confirmed debrief into a client recap email and internal handoff notes.

**Functional requirements**

- F03-FR1 Triggered from the F01 saved screen, from voice ("draft the recap to Jane"), or from the debrief detail screen.
- F03-FR2 Outputs: (a) client recap email to client attendees from Salesforce contacts; (b) internal handoffs, one per internal team referenced (Treasury Services, Credit, Portfolio Management, specialists).
- F03-FR3 Recipients only from Salesforce Contact/User records linked to the account or debrief. No free-typed external addresses in this build.
- F03-FR4 Commitment-language guard blocks or rewrites: "approved", "guaranteed", "we will lend", specific rates/terms/pricing, "commit to". Guard result shown to RM ("Commitment check passed").
- F03-FR5 Internal-only content (risk rating, complaint handling, internal credit views, MNPI) must not appear in client emails.
- F03-FR6 Drafts are saved via `MailAdapter.createDraft` into the RM's mailbox. Never sent.
- F03-FR7 RM can edit in-app before saving to drafts; edits are stored for tone learning (store edit pairs; do not train models in this build).

**Acceptance criteria**

- F03-AC1 Generated client email for the Acme debrief contains all included next steps and no risk/complaint/internal content.
- F03-AC2 Injected commitment language ("we guarantee approval at 6.1%") is caught by the guard and not present in the saved draft.
- F03-AC3 `MailAdapter.send` is never called anywhere in the codebase (enforced by a lint rule or test).

---

## F04 — Next-step tracking and nudges

**Purpose:** Keep RMs on top of meetings, tasks and promises.

**Functional requirements**

- F04-FR1 Morning agenda (push at RM-configured time, default 7:45 local) and Today screen: today's meetings with brief status, overdue tasks, client commitments due in the next 3 days, watchlist alerts (F06), coverage suggestions (F10).
- F04-FR2 Voice actions: "mark the Brightwater docs done", "push Castell to Thursday", "delegate the FX intro to Priya". Delegation requires confirmation.
- F04-FR3 Client commitments are Tasks with `clientCommitment=true`; they are visually distinct and prioritized.
- F04-FR4 Nudge preferences: cadence (morning only / morning + afternoon), channels (push / in-app), quiet hours, per-type mute. Duplicate nudges suppressed within 24 h.
- F04-FR5 Spoken agenda summary ≤ 60 s.

**Acceptance criteria**

- F04-AC1 Voice "mark done" updates the Task status through `WriteGateway` with confirmation.
- F04-AC2 Quiet hours suppress pushes; suppressed items appear in-app.
- F04-AC3 A commitment due today appears at the top of the Today list.

---

## F05 — Specialist referral routing

**Purpose:** Capture cross-sell interest and route it to the right partner with context.

**Functional requirements**

- F05-FR1 Sources: `specialistInterest` on confirmed debriefs, explicit voice request ("refer Acme to FX"), or chat.
- F05-FR2 Routing rules table (config): specialty × region × segment → partner queue/user. Specialties: Treasury Management, FX, Wealth, SBA, Capital Markets, Equipment Finance, Merchant Services.
- F05-FR3 Referral contains: account, contact, need summary (from debrief), urgency, RM notes, consent to share flag.
- F05-FR4 Referral is created as `Referral__c` in Salesforce via `WriteGateway` after RM confirmation; partner gets a mock notification.
- F05-FR5 Status tracking: Submitted → Accepted → Contacted → Opportunity created / Closed. RM sees status on the account and in a Referrals list.
- F05-FR6 After a debrief with specialist interest, Sherpa offers "Want me to send FX a referral for Acme?"

**Acceptance criteria**

- F05-AC1 Confirming a referral creates exactly one `Referral__c` routed per the rules table.
- F05-AC2 A specialty with no matching rule falls back to the default queue and logs a warning.

---

## F06 — Portfolio watchlist alerts

**Purpose:** Proactively flag portfolio events before they become problems.

**Alert rules (configurable thresholds)**

| Rule | Source | Default trigger |
|---|---|---|
| Maturity approaching | nCino/ACBS | Facility matures in ≤ 120 days, no renewal opportunity open |
| Covenant test due | nCino ticklers | Test due in ≤ 30 days |
| Covenant breach risk | Financial spreads | Latest DSCR/leverage within 10% of covenant |
| Financials past due | nCino ticklers | Statement overdue ≥ 1 day |
| Utilization swing | ACBS | Utilization change ≥ 25 points in 30 days |
| Deposit outflow | CoreDeposits | Balance down ≥ 20% vs 90-day average |
| Risk rating change | nCino | Any downgrade |

**Functional requirements**

- F06-FR1 Nightly batch job (and on-demand refresh) evaluates rules per RM book; creates `Alert` records with severity (info/warn/critical), evidence (values + source + asOf) and suggested action.
- F06-FR2 Alerts appear in Today, an Alerts tab, push (warn/critical), and in briefs (F02).
- F06-FR3 RM actions: acknowledge, snooze (7/30 days), create task, start a call note, dismiss with reason. Actions are audited.
- F06-FR4 Deduplicate: same rule + facility does not re-alert while open.

**Acceptance criteria**

- F06-AC1 Seed data produces the expected alert set (listed in `docs/07-mock-data.md`).
- F06-AC2 Snoozed alerts reappear after the snooze period (time-mocked test).

---

## F07 — Deal intake by voice

**Purpose:** Capture a new credit request by voice and pre-fill a **draft** nCino request.

**Functional requirements**

- F07-FR1 Triggers: "new deal for Acme", or a debrief opportunity tagged as credit.
- F07-FR2 Extracted fields: borrower, guarantors, product (term loan, line of credit, equipment, CRE, SBA 7(a)/504), amount, purpose, term/amortization, collateral, requested timing, use of proceeds, existing relationship exposure (looked up), known risks.
- F07-FR3 Sherpa asks for missing required fields (max 5 questions) and reads back amount, term and collateral.
- F07-FR4 Output is a **draft** request in nCino via `NcinoAdapter.createDraftRequest` with status `Draft — RM review`. Sherpa never submits to credit.
- F07-FR5 Links the draft to the Salesforce Opportunity (creates one if approved).
- F07-FR6 Hands off to the credit memo generator (external system) via an event `deal.draft_created` (mock).

**Acceptance criteria**

- F07-AC1 Scripted intake produces a draft with all required fields; submit endpoints are never called.
- F07-AC2 Amount read-back is required before draft creation.

---

## F08 — Document chase

**Purpose:** Track outstanding client documents and draft the requests.

**Functional requirements**

- F08-FR1 Sources: nCino ticklers (financial statements, tax returns, compliance certificates, insurance, borrowing base), KYC/CDD refresh requirements (`KycAdapter`).
- F08-FR2 Per account: list of outstanding items with due date, days overdue, last request date.
- F08-FR3 Sherpa drafts a single consolidated client request email per account (draft only, via F03 guardrails) and an optional reminder schedule (e.g., 7 and 14 days).
- F08-FR4 Marks items received when the mock document system reports receipt; RM can mark manually.
- F08-FR5 Shows in Today as "Documents due" and in briefs.

**Acceptance criteria**

- F08-AC1 Castell Foods (seed) shows overdue Q2 financials and a drafted request listing them.
- F08-AC2 Reminder schedule creates draft reminders, never sends.

---

## F09 — Talking points and next best conversation

**Purpose:** Suggest relevant conversation topics grounded in the relationship's data.

**Functional requirements**

- F09-FR1 Inputs: product holdings vs segment peer holdings (mock peer table), relationship profitability (PrecisionLender), recent debrief themes, news, watchlist events.
- F09-FR2 Output: up to 5 talking points, each with rationale, evidence (source + asOf), and suggested question to ask. Examples: "Uses wires heavily but no positive pay → ask about fraud controls."
- F09-FR3 Product-gap rules are deterministic (config table); the LLM only phrases the rationale and question. No pricing or approval language (F03 guard applies).
- F09-FR4 Shown in briefs (F02) and on the account screen. RM can give thumbs up/down; feedback stored.
- F09-FR5 Label: "Suggestions for discussion. Not a product recommendation to the client."

**Acceptance criteria**

- F09-AC1 Each talking point references at least one evidence item.
- F09-AC2 Removing a holding from seed data changes the gap suggestions deterministically.

---

## F10 — Coverage planning

**Purpose:** Make sure no relationship goes untouched.

**Functional requirements**

- F10-FR1 Computes days since last meaningful touch (meeting, call, debrief) per account in the RM's book.
- F10-FR2 Coverage rules by segment/tier: e.g., Commercial A-tier every 30 days, B-tier 60, C-tier 90; Small Business 90/180.
- F10-FR3 Weekly plan (Monday push): suggested 5–15 outreach targets ranked by overdue-ness, open alerts, maturities, referral status, and revenue band.
- F10-FR4 RM can accept (creates a Task), skip with reason, or schedule (creates a calendar hold via `CalendarAdapter.createHold`, after confirmation).
- F10-FR5 Team leader view (read-only): coverage % per RM.

**Acceptance criteria**

- F10-AC1 Seed data produces the expected overdue list and weekly plan ordering.
- F10-AC2 A leader cannot see client details outside their team.

---

## F11 — Live listening during client meetings (Tier 4, gated)

**Purpose:** Real-time capture during a client meeting, replacing the post-meeting debrief when consented.

**Gating:** flag `F11_LIVE_LISTENING` default `false`; requires `complianceApproved: true` and `allowedStates` list in config.

**Functional requirements**

- F11-FR1 Consent flow before start: RM confirms the meeting state/jurisdiction; if the jurisdiction requires all-party consent (config list), RM must confirm verbal consent from all parties was obtained; consent statement and timestamp recorded.
- F11-FR2 Visible, persistent "Listening" indicator; one-tap pause/stop.
- F11-FR3 Streaming transcription; no audio stored; transcript stored only after the RM confirms the resulting debrief.
- F11-FR4 Live side panel (RM-only) shows captured next steps and flags; no prompts to the RM during the meeting except optional silent cues.
- F11-FR5 At stop, flows into the F01 review card.
- F11-FR6 If consent not confirmed, start is blocked.

**Acceptance criteria**

- F11-AC1 With flag off or `complianceApproved=false`, the feature is invisible and its endpoints return 404.
- F11-AC2 Start is blocked without consent confirmation in an all-party-consent jurisdiction.

---

## F12 — Pricing guidance during the conversation (Tier 4, gated)

**Purpose:** Give RMs indicative internal pricing context while structuring a deal. RM-only; never client-facing.

**Gating:** flag `F12_PRICING_GUIDANCE` default `false`; requires `complianceApproved: true`.

**Functional requirements**

- F12-FR1 Inputs: deal parameters (from F07), relationship profitability and pricing model (PrecisionLender mock): target RAROC, indicative spread range, fee ranges, deposit relationship credit.
- F12-FR2 Output: an indicative range with drivers ("+deposits lowers spread by ~X bps"), labeled "Indicative internal guidance. Not a quote. Subject to credit approval and pricing authority."
- F12-FR3 Never spoken aloud by default (screen only); never included in client drafts (F03 guard blocks rates).
- F12-FR4 Every view is audited (who, deal, inputs, outputs).
- F12-FR5 Exceptions beyond RM pricing authority show "Requires pricing approval" and route nothing automatically.

**Acceptance criteria**

- F12-AC1 Guidance never appears in any generated client email (test with F03).
- F12-AC2 Every guidance request creates an audit record.

---

## F13 — Relationship health and attrition scoring (Tier 4, gated)

**Purpose:** Early warning on relationships at risk.

**Gating:** flag `F13_HEALTH_SCORE` default `false`; requires `complianceApproved: true` and `modelValidated: true`.

**Functional requirements**

- F13-FR1 Score 0–100 per relationship from a **transparent, rules-based scorecard** in this build (no ML): deposit trend, utilization trend, touch recency, complaints in 12 months, referral activity, product breadth, maturity without renewal.
- F13-FR2 Every score shows its top 3 drivers with values and sources.
- F13-FR3 Bands: Healthy (≥ 70), Watch (40–69), At risk (< 40). At-risk accounts appear in Today and coverage planning.
- F13-FR4 Scores are never shown to clients and never used for credit or pricing decisions (displayed disclaimer).
- F13-FR5 Score history stored weekly for trend display.
- F13-FR6 Must not use protected attributes or proxies (zip code, owner demographics); enforced by an allowlist of input fields with a test.

**Acceptance criteria**

- F13-AC1 Seed data produces expected bands for 5 named accounts.
- F13-AC2 Adding a non-allowlisted input field fails the test suite.

---

## 5. Cross-cutting requirements

- **Search/ask anything:** a global "Ask Sherpa" (voice or chat) that routes to the right feature tool.
- **Accounts:** account list (my book), account detail (overview, brief, debriefs, tasks, alerts, referrals, documents, talking points, health if enabled).
- **Notifications center** with all pushes.
- **Settings:** nudge preferences, privacy mode, voice speed, default meeting reminder offset.
- **Offline:** read-only cache of Today and last-viewed briefs; debrief drafts queue and sync when online. Writes never execute offline.
- **Performance:** first token of spoken response ≤ 1.5 s in OpenAI mode on good network; brief assembly ≤ 3 s with mocks.
- **Localization:** US English only in this build; all strings in a single i18n file.
