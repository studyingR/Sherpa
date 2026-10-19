/** Shared reads over the RM's book, each fact sourced with an as-of date (rule 6). */
import type { LoanRecord } from '@sherpa/adapters';
import {
  daysBetween,
  formatMoney,
  formatPct,
  formatShortDate,
  parseDate,
  toIsoDate,
  type Account,
  type SourcedFact,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import type { Deps } from '../deps';
import { assertInBook } from '../auth/entitlements';
import { notFound } from '../lib/errors';

export const f = (key: string, label: string, value: string | number, display: string, source: SourcedFact['source'], asOf: string): SourcedFact => ({
  key, label, value, display, source, asOf,
});

export function createBookService(d: Deps) {
  const { adapters } = d;

  async function account(ctx: UserContext, accountId: string) {
    assertInBook(ctx, accountId);
    const a = await adapters.salesforce.getAccount(ctx, accountId);
    if (!a) throw notFound('That account');
    return a;
  }

  async function lastTouch(ctx: UserContext, accountIds: string[]): Promise<Record<string, number | null>> {
    const raw = await adapters.salesforce.getLastTouch(ctx, accountIds);
    const today = d.clock.today();
    return Object.fromEntries(Object.entries(raw).map(([id, iso]) => [id, iso ? daysBetween(new Date(iso), today) : null]));
  }

  function overviewFacts(a: Account & { profile: Record<string, unknown> }, touchDays: number | null, touchAsOf: string): SourcedFact[] {
    const facts = [
      f('account.since', 'Relationship since', a.relationshipSince, a.relationshipSince.slice(0, 4), 'SALESFORCE', touchAsOf),
      f('account.tier', 'Coverage tier', a.coverageTier, `Tier ${a.coverageTier}`, 'SALESFORCE', touchAsOf),
      f('account.industry', 'Industry', a.industry, a.industry, 'SALESFORCE', touchAsOf),
      f('account.revenue', 'Annual revenue', a.annualRevenueBand, a.annualRevenueBand, 'SALESFORCE', touchAsOf),
    ];
    if (touchDays !== null) facts.push(f('account.lastTouch', 'Last touch', touchDays, `${touchDays} days ago`, 'SALESFORCE', touchAsOf));
    return facts;
  }

  function creditFacts(loans: LoanRecord[], today: Date): SourcedFact[] {
    const facts: SourcedFact[] = [];
    for (const l of loans) {
      const util = l.commitment ? (l.outstanding / l.commitment) * 100 : 0;
      const days = daysBetween(today, parseDate(l.maturityDate));
      const p = `loan.${l.id}`;
      facts.push(
        f(`${p}.commitment`, `${l.product} commitment`, l.commitment, formatMoney(l.commitment), 'NCINO', l.asOf),
        f(`${p}.outstanding`, `${l.product} outstanding`, l.outstanding, formatMoney(l.outstanding), 'NCINO', l.asOf),
      );
      if (/line|revolv/i.test(l.product)) facts.push(f(`${p}.utilization`, `${l.product} utilization`, Math.round(util), formatPct(util), 'NCINO', l.asOf));
      facts.push(
        f(`${p}.maturity`, `${l.product} maturity`, l.maturityDate, `${formatShortDate(l.maturityDate)} ${parseDate(l.maturityDate).getFullYear()} (${days} days)`, 'NCINO', l.asOf),
        f(`${p}.riskRating`, `${l.product} risk rating`, l.riskRating, String(l.riskRating), 'NCINO', l.asOf),
      );
    }
    return facts;
  }

  async function depositSummary(ctx: UserContext, accountId: string) {
    const [bal, hist, products] = await Promise.all([
      adapters.deposits.getBalances(ctx, accountId),
      adapters.deposits.getBalanceHistory(ctx, accountId, 90),
      adapters.deposits.getTreasuryProducts(ctx, accountId),
    ]);
    const avg = hist.length ? hist.reduce((a, b) => a + b.balance, 0) / hist.length : bal.balance;
    const trendPct = avg ? ((bal.balance - avg) / avg) * 100 : 0;
    const facts: SourcedFact[] = [
      f('deposits.balance', 'Deposit balance', bal.balance, formatMoney(bal.balance), 'CORE_DEPOSITS', bal.asOf),
      f('deposits.avg90', '90-day average balance', Math.round(avg), formatMoney(avg), 'CORE_DEPOSITS', bal.asOf),
      f('deposits.trend', '90-day trend', Math.round(trendPct), `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(0)}% vs average`, 'CORE_DEPOSITS', bal.asOf),
      f('deposits.products', 'Treasury products', products.length, products.map((p) => p.product).join(', ') || 'None', 'CORE_DEPOSITS', bal.asOf),
    ];
    return { balance: bal.balance, avg, trendPct, products: products.map((p) => p.product), history: hist, facts, asOf: bal.asOf };
  }

  async function utilizationByFacility(ctx: UserContext, loans: LoanRecord[]) {
    const lines = loans.filter((l) => /line|revolv/i.test(l.product));
    const entries = await Promise.all(lines.map(async (l) => [l.id, await adapters.acbs.getUtilizationHistory(ctx, l.id, 90)] as const));
    return Object.fromEntries(entries.filter(([, h]) => h.length));
  }

  return {
    account,
    lastTouch,
    overviewFacts,
    creditFacts,
    depositSummary,
    utilizationByFacility,
    todayIso: () => toIsoDate(d.clock.today()),
  };
}
export type BookService = ReturnType<typeof createBookService>;
