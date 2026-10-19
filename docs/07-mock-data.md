# 07 — Mock Data (synthetic)

All names, companies and figures are fictional. Seed via `apps/server/prisma/seed.ts`. The seed must be **deterministic** (fixed IDs and dates relative to a configurable "today" — default: the current date at seed time, with all dates computed as offsets so tests can freeze time via `SEED_TODAY=2026-10-19`).

## 1. Users (personas)

| id | name | role | segment | region | team |
|---|---|---|---|---|---|
| `u_maya` | Maya Chen | RM | COMMERCIAL | NJ Central | team_nj |
| `u_devon` | Devon Brooks | RM | SMALL_BUSINESS | NJ Central | team_nj |
| `u_priya` | Priya Shah | ANALYST | COMMERCIAL | NJ Central | team_nj |
| `u_sam` | Sam Ortiz | LEADER | COMMERCIAL | NJ Central | team_nj |
| `u_jordan` | Jordan Lee | COMPLIANCE | — | — | — |

Internal teams (for owners/routing): Treasury Services, Credit Admin, Portfolio Management, FX Desk, Wealth, SBA Desk, Capital Markets, Equipment Finance, Merchant Services.

## 2. Maya's accounts (Commercial)

| Account | City, ST | Tier | Industry | Key facts |
|---|---|---|---|---|
| Acme Manufacturing | Newark, NJ | A | Industrial machinery | $5M revolver, 62% utilized, matures in 14 months; term loan $3.2M; deposits $4.1M; wires heavy; no FX product; contacts Jane Ruiz (CFO), Tom Lee (Controller) |
| Harbor Logistics | Elizabeth, NJ | A | Freight & warehousing | $8M line **matures in 74 days**, no renewal opp; utilization up from 40% to 71% in 30 days (**utilization swing**) |
| Castell Foods | Edison, NJ | B | Food distribution | **Q2 financials 3 days overdue**; covenant test (DSCR ≥ 1.25x) due in 26 days; latest DSCR 1.31x (**breach risk**) |
| Brightwater Farms | Princeton, NJ | B | Agriculture | Renewal docs promised "by today" (client commitment task due today) |
| Northgate Dental Partners | Trenton, NJ | C | Healthcare services | Last touch **96 days ago** (coverage overdue); deposits down 24% vs 90-day avg (**deposit outflow**) |
| Riverline Plastics | Paterson, NJ | B | Plastics | Risk rating downgraded 5 → 6 last week (**downgrade**) |
| Summit Ridge Builders | Morristown, NJ | A | Construction | Healthy; open treasury opportunity; good test of "no alerts" |
| Pinecrest Medical Supply | New Brunswick, NJ | C | Distribution | KYC refresh due in 10 days |

## 3. Devon's accounts (Small Business)

Generate 40 small business accounts with a deterministic generator (seeded PRNG) plus 5 named ones: Greenline Dental Group, Lakeside Auto Repair, Maple Street Bakery, Corner Hardware Co., Bright Path Tutoring. Mix of last-touch ages (10–250 days) to exercise coverage.

## 4. Calendar (relative to SEED_TODAY)

| When | Account | Attendees | Notes |
|---|---|---|---|
| Today 2:00–3:00 PM | Acme Manufacturing | Jane Ruiz, Tom Lee | Annual review, in person — **ended, debrief pending** |
| Today 4:00 PM | Harbor Logistics | Ana Patel (CFO) | Line renewal |
| Tomorrow 9:30 AM | Greenline Dental Group (Devon) | Dr. Lena Ortiz | Check-in |
| Tomorrow 11:00 AM | Castell Foods | Mark Castell (Owner) | Financials discussion |
| +2 days | Summit Ridge Builders | Owen Hart (CFO) | Treasury review |

## 5. Expected alert set (F06-AC1)

| Account | Rule | Severity |
|---|---|---|
| Harbor Logistics | MATURITY_APPROACHING | WARN |
| Harbor Logistics | UTILIZATION_SWING | WARN |
| Castell Foods | FINANCIALS_PAST_DUE | WARN |
| Castell Foods | COVENANT_TEST_DUE | INFO |
| Castell Foods | COVENANT_BREACH_RISK | CRITICAL |
| Northgate Dental Partners | DEPOSIT_OUTFLOW | WARN |
| Riverline Plastics | RISK_RATING_DOWNGRADE | CRITICAL |

Summit Ridge Builders and Acme Manufacturing produce **no** alerts.

## 6. Expected health bands (F13-AC1, when enabled)

| Account | Band |
|---|---|
| Summit Ridge Builders | HEALTHY |
| Acme Manufacturing | HEALTHY |
| Harbor Logistics | WATCH |
| Castell Foods | WATCH |
| Northgate Dental Partners | AT_RISK |

## 7. Product-gap rules (F09) — seed config

| Rule id | Condition | Talking point |
|---|---|---|
| `TP_FX_NO_PRODUCT` | Foreign supplier/FX mention in debriefs or international wires > 0, no FX product | FX hedging and international payments |
| `TP_POSPAY` | Wire/ACH volume high, no Positive Pay | Fraud controls / Positive Pay |
| `TP_SWEEP` | Avg collected balance > $2M, no sweep | Liquidity / sweep account |
| `TP_MERCHANT` | Retail/healthcare industry, no merchant services | Card acceptance |
| `TP_EQUIP` | Capex or expansion mentioned, no equipment finance | Equipment financing |
| `TP_RENEWAL` | Maturity ≤ 180 days | Renewal planning conversation |

## 8. Scripted debriefs (golden set for tests and evals)

Store under `packages/evals/golden/*.json` as `{ id, meeting, rmTurns[], expected: DebriefDraft (subset) }`.

### G1 — Acme annual review (happy path, from prototype)

RM turns:
1. "Yes, that's the one."
2. "Good meeting. They're expanding the Newark plant and need about two and a half million in equipment financing, probably Q1. Jane complained that wires were delayed twice this month. They're starting to buy from a German supplier, so FX came up. I said I'd send a term sheet by Friday."
3. (Gap-fill answer) "Treasury services should call Jane by Wednesday."
4. (Opportunity approval) "Yes."
5. "Confirm."

Expected: purpose ANNUAL_REVIEW; attendees Jane Ruiz (CFO), Tom Lee (Controller); opportunity Equipment financing 2,500,000, Q1 next year, approved; next steps: "Send equipment financing term sheet" (Maya, Friday, clientCommitment true), "Call Jane about wire delays" (Treasury Services, Wednesday), "Introduce FX specialist" (Maya, may be added from FX interest — accept with or without due date); specialistInterest includes FX, EQUIPMENT_FINANCE, TREASURY_MANAGEMENT; complaint flagged (wire delays); MNPI false.

### G2 — Opportunity not approved

Same as G1 but turn 4 = "Not yet, hold off." Expected: opportunity held; saved screen shows "Held · not approved".

### G3 — No complaint false positive

"Jane said the wire team has been great lately and complimented Tom's onboarding. No issues." Expected: complaint false.

### G4 — MNPI

"Owen mentioned off the record they're in talks to acquire a competitor, nothing's public yet." Expected: mnpi true; complaint false.

### G5 — Ambiguous amount

"They want maybe one point five for a new line." Expected: amount added to missingFields, gap question asks for amount.

### G6 — No next steps

"Quick check-in, nothing to follow up." + "No next steps." Expected: valid with zero tasks.

### G7 — Small business, Devon

Greenline Dental: "Dr. Ortiz wants to accept card payments at the front desk and asked about an SBA loan for a second location, around four hundred thousand." Expected: specialistInterest MERCHANT_SERVICES, SBA; opportunity SBA 400,000.

### G8 — Sensitive attribute

"She mentioned she's going on medical leave for surgery next month, so loop in Tom." Expected: sensitive flagged (health); prompt to remove; next step to loop in Tom retained.

Add at least 12 more varied cases (renewals, treasury reviews, issue resolution, multiple opportunities, corrections during read-back) to reach 20 golden cases for the eval harness.
