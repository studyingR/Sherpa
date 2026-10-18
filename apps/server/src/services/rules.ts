/**
 * Deterministic rules engines (docs/05 §1: "Deterministic first, LLM second").
 * Alert thresholds (F06), health scorecard (F13), coverage (F10) and product gaps (F09) are pure functions.
 */
import {
  addDays,
  daysBetween,
  formatMoney,
  formatPct,
  formatShortDate,
  parseDate,
  type AlertRule,
  type CoverageTier,
  type HealthBand,
  type Segment,
  type Severity,
  type SourcedFact,
} from '@sherpa/shared';
import type { CovenantRecord, LoanRecord, SpreadRecord, TicklerRecord } from '@sherpa/adapters';

export const ALERT_THRESHOLDS = {
  maturityDays: 120,
  covenantTestDays: 30,
  breachMarginPct: 10,
  financialsOverdueDays: 1,
  utilizationSwingPts: 25,
  utilizationWindowDays: 30,
  depositOutflowPct: 20,
  downgradeLookbackDays: 90,
};

export interface AlertCandidate {
  rule: AlertRule;
  severity: Severity;
  facilityId: string;
  title: string;
  evidence: SourcedFact[];
  suggestedAction: string;
}

export interface AlertInputs {
  accountId: string;
  accountName: string;
  today: Date;
  loans: LoanRecord[];
  covenants: CovenantRecord[];
  spreads: SpreadRecord[];
  ticklers: TicklerRecord[];
  utilization: Record<string, { date: string; utilization: number }[]>;
  deposits: { date: string; balance: number }[];
}

const fact = (key: string, label: string, value: string | number, display: string, source: SourcedFact['source'], asOf: string): SourcedFact => ({ key, label, value, display, source, asOf });

export function evaluateAlertRules(i: AlertInputs, t = ALERT_THRESHOLDS): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const todayIso = i.today.toISOString();

  for (const loan of i.loans) {
    const days = daysBetween(i.today, parseDate(loan.maturityDate));
    if (days >= 0 && days <= t.maturityDays && !loan.renewalOppOpen) {
      out.push({
        rule: 'MATURITY_APPROACHING', severity: days <= 30 ? 'CRITICAL' : 'WARN', facilityId: loan.id,
        title: `${loan.product} matures in ${days} days`,
        evidence: [
          fact('loan.maturity', 'Maturity date', loan.maturityDate, formatShortDate(loan.maturityDate), 'NCINO', loan.asOf),
          fact('loan.commitment', 'Commitment', loan.commitment, formatMoney(loan.commitment), 'NCINO', loan.asOf),
          fact('opp.renewal', 'Renewal opportunity', 'none', 'None open', 'SALESFORCE', todayIso),
        ],
        suggestedAction: 'Open a renewal opportunity and schedule a renewal conversation.',
      });
    }
    if (loan.prevRiskRating !== null && loan.riskRating > loan.prevRiskRating && loan.ratingChangedAt) {
      const ago = daysBetween(new Date(loan.ratingChangedAt), i.today);
      if (ago <= t.downgradeLookbackDays) {
        out.push({
          rule: 'RISK_RATING_DOWNGRADE', severity: 'CRITICAL', facilityId: loan.id,
          title: `Risk rating downgraded ${loan.prevRiskRating} → ${loan.riskRating}`,
          evidence: [fact('loan.riskRating', 'Risk rating', loan.riskRating, `${loan.prevRiskRating} → ${loan.riskRating}`, 'NCINO', loan.ratingChangedAt)],
          suggestedAction: 'Review the credit file with Portfolio Management and plan a client conversation.',
        });
      }
    }
  }

  for (const c of i.covenants) {
    const days = daysBetween(i.today, parseDate(c.testDueDate));
    if (days >= 0 && days <= t.covenantTestDays) {
      out.push({
        rule: 'COVENANT_TEST_DUE', severity: 'INFO', facilityId: c.id,
        title: `${c.name} test due in ${days} days`,
        evidence: [fact('covenant.testDue', `${c.metric} test due`, c.testDueDate, formatShortDate(c.testDueDate), 'NCINO', todayIso)],
        suggestedAction: 'Request the compliance certificate and supporting financials.',
      });
    }
    const latest = i.spreads[0];
    if (latest) {
      const value = c.metric === 'DSCR' ? latest.dscr : latest.leverage;
      const margin = t.breachMarginPct / 100;
      const atRisk = c.operator === '>=' ? value <= c.threshold * (1 + margin) : value >= c.threshold * (1 - margin);
      if (atRisk) {
        out.push({
          rule: 'COVENANT_BREACH_RISK', severity: 'CRITICAL', facilityId: c.id,
          title: `${c.metric} ${value.toFixed(2)}x is within ${t.breachMarginPct}% of the ${c.threshold.toFixed(2)}x covenant`,
          evidence: [
            fact('spread.latest', `Latest ${c.metric}`, value, `${value.toFixed(2)}x`, 'NCINO', latest.asOf),
            fact('covenant.threshold', c.operator === '>=' ? 'Covenant minimum' : 'Covenant maximum', c.threshold, `${c.threshold.toFixed(2)}x`, 'NCINO', todayIso),
          ],
          suggestedAction: 'Get interim financials and discuss the outlook before the test date.',
        });
      }
    }
  }

  for (const tk of i.ticklers) {
    if (tk.type !== 'FINANCIAL_STATEMENT' || tk.status !== 'OUTSTANDING') continue;
    const overdue = daysBetween(parseDate(tk.dueDate), i.today);
    if (overdue >= t.financialsOverdueDays) {
      out.push({
        rule: 'FINANCIALS_PAST_DUE', severity: 'WARN', facilityId: tk.id,
        title: `${tk.period ?? ''} financial statements ${overdue} day${overdue === 1 ? '' : 's'} overdue`.trim(),
        evidence: [fact('tickler.due', 'Due date', tk.dueDate, formatShortDate(tk.dueDate), 'NCINO', todayIso)],
        suggestedAction: 'Send a document request for the overdue statements.',
      });
    }
  }

  for (const [facilityId, hist] of Object.entries(i.utilization)) {
    if (hist.length < 2) continue;
    const windowStart = addDays(i.today, -t.utilizationWindowDays);
    const inWindow = hist.filter((h) => parseDate(h.date) >= windowStart);
    const before = [...hist].reverse().find((h) => parseDate(h.date) <= windowStart) ?? hist[0];
    const latest = hist[hist.length - 1];
    const swing = latest.utilization - before.utilization;
    if (inWindow.length && Math.abs(swing) >= t.utilizationSwingPts) {
      out.push({
        rule: 'UTILIZATION_SWING', severity: 'WARN', facilityId,
        title: `Line utilization ${swing > 0 ? 'up' : 'down'} ${Math.round(Math.abs(swing))} points in 30 days`,
        evidence: [
          fact('util.before', 'Utilization 30 days ago', before.utilization, formatPct(before.utilization), 'ACBS', before.date),
          fact('util.latest', 'Utilization now', latest.utilization, formatPct(latest.utilization), 'ACBS', latest.date),
        ],
        suggestedAction: 'Ask what is driving the draw and whether working capital needs have changed.',
      });
    }
  }

  if (i.deposits.length > 10) {
    const avg = i.deposits.reduce((a, b) => a + b.balance, 0) / i.deposits.length;
    const latest = i.deposits[i.deposits.length - 1];
    const change = ((latest.balance - avg) / avg) * 100;
    if (change <= -t.depositOutflowPct) {
      out.push({
        rule: 'DEPOSIT_OUTFLOW', severity: 'WARN', facilityId: `DEP-${i.accountId}`,
        title: `Deposits down ${Math.round(-change)}% vs 90-day average`,
        evidence: [
          fact('deposits.balance', 'Current balance', latest.balance, formatMoney(latest.balance), 'CORE_DEPOSITS', latest.date),
          fact('deposits.avg90', '90-day average', Math.round(avg), formatMoney(avg), 'CORE_DEPOSITS', latest.date),
        ],
        suggestedAction: 'Check in on cash needs and whether funds moved to another bank.',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- F13 health scorecard
/** C-17: the scorecard may only use these inputs. No protected attributes or proxies (zip code, demographics). */
export const HEALTH_INPUT_ALLOWLIST = [
  'depositTrendPct',
  'utilizationChangePts',
  'daysSinceTouch',
  'complaints12m',
  'referrals12m',
  'productCount',
  'maturityWithoutRenewalDays',
] as const;
export type HealthInputs = Record<(typeof HEALTH_INPUT_ALLOWLIST)[number], number | null>;

export function scoreHealth(inputs: HealthInputs): { score: number; band: HealthBand; drivers: { factor: string; impact: number; input: keyof HealthInputs }[] } {
  for (const k of Object.keys(inputs)) {
    if (!(HEALTH_INPUT_ALLOWLIST as readonly string[]).includes(k)) throw new Error(`Health input "${k}" is not on the allowlist`);
  }
  const d: { factor: string; impact: number; input: keyof HealthInputs }[] = [];
  const dep = inputs.depositTrendPct;
  if (dep !== null) {
    if (dep <= -20) d.push({ factor: 'Deposits well below 90-day average', impact: -30, input: 'depositTrendPct' });
    else if (dep <= -10) d.push({ factor: 'Deposits trending down', impact: -15, input: 'depositTrendPct' });
  }
  const util = inputs.utilizationChangePts;
  if (util !== null) {
    if (Math.abs(util) >= 25) d.push({ factor: 'Large swing in line utilization', impact: -20, input: 'utilizationChangePts' });
    else if (Math.abs(util) >= 10) d.push({ factor: 'Utilization moving', impact: -10, input: 'utilizationChangePts' });
  }
  const touch = inputs.daysSinceTouch;
  if (touch !== null) {
    if (touch > 90) d.push({ factor: 'No contact in over 90 days', impact: -25, input: 'daysSinceTouch' });
    else if (touch > 60) d.push({ factor: 'No contact in over 60 days', impact: -15, input: 'daysSinceTouch' });
    else if (touch > 30) d.push({ factor: 'No contact in over 30 days', impact: -10, input: 'daysSinceTouch' });
  }
  const complaints = inputs.complaints12m ?? 0;
  if (complaints > 0) d.push({ factor: `${complaints} complaint${complaints > 1 ? 's' : ''} in 12 months`, impact: -Math.min(20, complaints * 10), input: 'complaints12m' });
  if ((inputs.referrals12m ?? 0) > 0) d.push({ factor: 'Recent specialist referral activity', impact: 5, input: 'referrals12m' });
  if (inputs.productCount !== null && inputs.productCount <= 3) d.push({ factor: 'Few products with us', impact: -10, input: 'productCount' });
  const mat = inputs.maturityWithoutRenewalDays;
  if (mat !== null && mat <= 120) d.push({ factor: 'Facility maturing without a renewal in progress', impact: -15, input: 'maturityWithoutRenewalDays' });

  const score = Math.max(0, Math.min(100, 100 + d.reduce((a, b) => a + b.impact, 0)));
  const band: HealthBand = score >= 70 ? 'HEALTHY' : score >= 40 ? 'WATCH' : 'AT_RISK';
  return { score, band, drivers: d.sort((a, b) => a.impact - b.impact) };
}

// ---------------------------------------------------------------- F10 coverage
export function coverageTarget(segment: Segment, tier: CoverageTier): number {
  if (segment === 'COMMERCIAL') return { A: 30, B: 60, C: 90 }[tier];
  return { A: 90, B: 180, C: 180 }[tier];
}

export interface CoverageInput {
  accountId: string;
  accountName: string;
  segment: Segment;
  tier: CoverageTier;
  daysSinceTouch: number;
  openAlerts: number;
  daysToMaturity: number | null;
  referralPending: boolean;
  revenueBand: string;
}

function revenueWeight(band: string): number {
  if (/250|100M/.test(band)) return 5;
  if (/50M/.test(band)) return 4;
  if (/25M/.test(band)) return 3;
  if (/10M|5M/.test(band)) return 2;
  return 1;
}

export function rankCoverage(items: CoverageInput[]) {
  return items
    .map((i) => {
      const targetDays = coverageTarget(i.segment, i.tier);
      const overdueBy = i.daysSinceTouch - targetDays;
      const reasons: string[] = [`${i.daysSinceTouch} days since last touch`];
      if (i.openAlerts) reasons.push(`${i.openAlerts} open alert${i.openAlerts > 1 ? 's' : ''}`);
      if (i.daysToMaturity !== null && i.daysToMaturity <= 180) reasons.push(`line matures in ${i.daysToMaturity} days`);
      if (i.referralPending) reasons.push('referral in progress');
      const score =
        Math.max(0, overdueBy) * 3 + (i.daysSinceTouch / targetDays) * 25 + i.openAlerts * 10 +
        (i.daysToMaturity !== null && i.daysToMaturity <= 180 ? 15 : 0) + (i.referralPending ? 5 : 0) + revenueWeight(i.revenueBand);
      return { accountId: i.accountId, accountName: i.accountName, daysSinceTouch: i.daysSinceTouch, targetDays, overdueBy, score: Math.round(score * 10) / 10, reasons };
    })
    .sort((a, b) => Number(b.overdueBy > 0) - Number(a.overdueBy > 0) || b.score - a.score || a.accountName.localeCompare(b.accountName));
}

// ---------------------------------------------------------------- F09 product gaps
export interface ProductGapInput {
  accountName: string;
  industry: string;
  products: string[];
  intlWiresPerMonth: number;
  wireAchMonthly: number;
  avgCollectedBalance: number;
  fxMentioned: boolean;
  capexMentioned: boolean;
  daysToNearestMaturity: number | null;
  asOf: string;
}

/** Seed config (docs/07 §7). The LLM only phrases these; it never decides them (F09-FR3). */
export function evaluateProductGaps(i: ProductGapInput): { ruleId: string; title: string; evidence: SourcedFact[] }[] {
  const has = (re: RegExp) => i.products.some((p) => re.test(p));
  const productsFact = fact('products', 'Treasury products', i.products.length, i.products.join(', ') || 'None', 'CORE_DEPOSITS', i.asOf);
  const out: { ruleId: string; title: string; evidence: SourcedFact[] }[] = [];
  if ((i.fxMentioned || i.intlWiresPerMonth > 0) && !has(/fx/i)) {
    out.push({ ruleId: 'TP_FX_NO_PRODUCT', title: 'FX hedging and international payments', evidence: [fact('wires.intl', 'International wires per month', i.intlWiresPerMonth, String(i.intlWiresPerMonth), 'CORE_DEPOSITS', i.asOf), productsFact] });
  }
  if (i.wireAchMonthly >= 100 && !has(/positive pay/i)) {
    out.push({ ruleId: 'TP_POSPAY', title: 'Fraud controls and Positive Pay', evidence: [fact('payments.volume', 'Wires and ACH per month', i.wireAchMonthly, String(i.wireAchMonthly), 'CORE_DEPOSITS', i.asOf), productsFact] });
  }
  if (i.avgCollectedBalance > 2_000_000 && !has(/sweep/i)) {
    out.push({ ruleId: 'TP_SWEEP', title: 'Liquidity and sweep accounts', evidence: [fact('deposits.avgCollected', 'Average collected balance', i.avgCollectedBalance, formatMoney(i.avgCollectedBalance), 'CORE_DEPOSITS', i.asOf)] });
  }
  if (/retail|health|dental|medical|restaurant|food|bakery|auto|hardware|fitness|veterinar|pharmacy/i.test(i.industry) && !has(/merchant/i)) {
    out.push({ ruleId: 'TP_MERCHANT', title: 'Card acceptance', evidence: [fact('account.industry', 'Industry', i.industry, i.industry, 'SALESFORCE', i.asOf), productsFact] });
  }
  if (i.capexMentioned && !has(/equipment/i)) {
    out.push({ ruleId: 'TP_EQUIP', title: 'Equipment financing', evidence: [fact('signals.capex', 'Capex or expansion signal', 'yes', 'Expansion mentioned recently', 'SHERPA', i.asOf)] });
  }
  if (i.daysToNearestMaturity !== null && i.daysToNearestMaturity <= 180) {
    out.push({ ruleId: 'TP_RENEWAL', title: 'Renewal planning conversation', evidence: [fact('loan.daysToMaturity', 'Days to maturity', i.daysToNearestMaturity, `${i.daysToNearestMaturity} days`, 'NCINO', i.asOf)] });
  }
  return out.slice(0, 5);
}
