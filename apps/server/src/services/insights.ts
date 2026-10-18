/** F08 documents, F09 talking points, F10 coverage, F13 health — all grounded in deterministic rules. */
import { createHash, randomUUID } from 'node:crypto';
import {
  addDays,
  daysBetween,
  parseDate,
  toIsoDate,
  type CoverageItem,
  type CoveragePlan,
  type DocumentItem,
  type HealthScore,
  type SourcedFact,
  type TalkingPoint,
  type WriteIntent,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook, assertRole } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError, notFound } from '../lib/errors';
import type { AlertService } from './alerts';
import { f, type BookService } from './book';
import { HEALTH_INPUT_ALLOWLIST, evaluateProductGaps, rankCoverage, scoreHealth, type HealthInputs } from './rules';

// ====================================================================== F08 documents
export function createDocumentService(d: Deps) {
  const { adapters, clock, db } = d;

  async function itemsFor(ctx: UserContext, accountId: string, accountName: string): Promise<DocumentItem[]> {
    const today = clock.today();
    const [ticklers, kyc] = await Promise.all([adapters.ncino.getTicklers(ctx, accountId), adapters.kyc.getRefreshRequirements(ctx, accountId)]);
    const items: DocumentItem[] = [
      ...ticklers.map((t): DocumentItem => ({
        id: t.id, accountId, accountName, type: t.type as DocumentItem['type'], period: t.period ?? undefined, dueDate: t.dueDate,
        daysOverdue: Math.max(0, daysBetween(parseDate(t.dueDate), today)), lastRequestedAt: t.lastRequestedAt ?? undefined,
        status: t.status, source: 'NCINO',
      })),
      ...kyc.map((k): DocumentItem => ({
        id: k.id, accountId, accountName, type: 'KYC_REFRESH', dueDate: k.dueDate,
        daysOverdue: Math.max(0, daysBetween(parseDate(k.dueDate), today)), status: k.status as DocumentItem['status'], source: 'KYC',
      })),
    ];
    // Show when we last asked (from Sherpa's own request log).
    const reqs = await db.documentRequest.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
    for (const it of items) {
      const r = reqs.find((x) => (JSON.parse(x.itemsJson) as string[]).includes(it.id));
      if (r && (!it.lastRequestedAt || r.createdAt.toISOString() > it.lastRequestedAt)) it.lastRequestedAt = r.createdAt.toISOString();
    }
    return items.sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
  }

  return {
    itemsFor,
    async list(ctx: UserContext, accountId?: string): Promise<DocumentItem[]> {
      const accounts = accountId
        ? [await adapters.salesforce.getAccount(ctx, (assertInBook(ctx, accountId), accountId))].filter(Boolean)
        : await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
      const all = await Promise.all(accounts.map((a) => itemsFor(ctx, a!.id, a!.name)));
      return all.flat().filter((i) => i.status === 'OUTSTANDING');
    },
    /** Today: overdue or due within 14 days. */
    async dueSoon(ctx: UserContext): Promise<DocumentItem[]> {
      const horizon = toIsoDate(addDays(clock.today(), 14));
      return (await this.list(ctx)).filter((i) => i.daysOverdue > 0 || i.dueDate <= horizon);
    },
    async mark(ctx: UserContext, itemId: string, status: 'RECEIVED' | 'WAIVED'): Promise<DocumentItem> {
      // Look the item up inside the RM's own book, so entitlements apply before anything is written.
      const item = (await this.list(ctx)).find((i) => i.id === itemId);
      if (!item) throw notFound('That document');
      const isKyc = item.source === 'KYC';
      // The RM's tap is the confirmation; the write is audited like every other external write.
      if (isKyc) await adapters.kyc.markRequirement(ctx, itemId, status);
      else await adapters.ncino.markTickler(ctx, itemId, status);
      await d.audit.record({ userId: ctx.rmId, action: `document.${status.toLowerCase()}`, system: isKyc ? 'KYC' : 'NCINO', object: isKyc ? 'KycRequirement' : 'Tickler', targetId: itemId, accountId: item.accountId, confirmation: { channel: 'tap' }, before: { status: item.status }, after: { status }, requestId: ctx.requestId, at: clock.now() });
      return { ...item, status };
    },
  };
}
export type DocumentService = ReturnType<typeof createDocumentService>;

// ====================================================================== F09 talking points
export function createTalkingPointService(d: Deps, book: BookService) {
  const { adapters, db, model, clock } = d;
  const phraseCache = new Map<string, { rationale: string; question: string }>();

  return {
    async forAccount(ctx: UserContext, accountId: string): Promise<TalkingPoint[]> {
      const a = await book.account(ctx, accountId);
      const [dep, loans, debriefs, news] = await Promise.all([
        book.depositSummary(ctx, accountId),
        adapters.ncino.getLoans(ctx, accountId),
        db.debrief.findMany({ where: { accountId }, orderBy: { confirmedAt: 'desc' }, take: 3 }),
        adapters.news.getNews(ctx, accountId, 60),
      ]);
      const debriefText = debriefs.map((x) => (JSON.parse(x.resultJson) as { themes?: string }).themes ?? '').join(' ');
      const today = clock.today();
      const maturities = loans.map((l) => daysBetween(today, parseDate(l.maturityDate))).filter((n) => n >= 0);
      const gaps = evaluateProductGaps({
        accountName: a.name,
        industry: a.industry,
        products: dep.products,
        intlWiresPerMonth: Number(a.profile.intlWiresPerMonth ?? 0),
        wireAchMonthly: Number(a.profile.wireAchMonthly ?? 0),
        avgCollectedBalance: Math.round(dep.avg),
        fxMentioned: /\b(fx|foreign|german|international|import)/i.test(debriefText),
        capexMentioned: Boolean(a.profile.capexMentioned) || /\b(expan\w*|capex|new plant|new location|equipment)/i.test(debriefText + ' ' + news.map((n) => n.headline).join(' ')),
        daysToNearestMaturity: maturities.length ? Math.min(...maturities) : null,
        asOf: dep.asOf,
      });
      const feedback = await db.talkingPointFeedback.findMany({ where: { userId: ctx.rmId, accountId } });
      return Promise.all(
        gaps.map(async (g) => {
          const key = createHash('sha1').update(`${accountId}:${g.ruleId}:${JSON.stringify(g.evidence.map((e) => e.display))}`).digest('hex');
          let phr = phraseCache.get(key);
          if (!phr) {
            phr = await model.phraseTalkingPoint({ ruleId: g.ruleId, title: g.title, accountName: a.name, evidence: g.evidence });
            phraseCache.set(key, phr);
          }
          return {
            id: `${accountId}:${g.ruleId}`, accountId, title: g.title, rationale: phr.rationale, question: phr.question,
            evidence: g.evidence, ruleId: g.ruleId, feedback: feedback.find((x) => x.ruleId === g.ruleId)?.feedback as TalkingPoint['feedback'],
          };
        }),
      );
    },
    async feedback(ctx: UserContext, id: string, value: 'UP' | 'DOWN') {
      const [accountId, ruleId] = id.split(':');
      if (!accountId || !ruleId) throw notFound('That talking point');
      assertInBook(ctx, accountId);
      await db.talkingPointFeedback.upsert({
        where: { userId_accountId_ruleId: { userId: ctx.rmId, accountId, ruleId } },
        create: { id: randomUUID(), userId: ctx.rmId, accountId, ruleId, feedback: value, at: clock.now() },
        update: { feedback: value, at: clock.now() },
      });
      return { ok: true };
    },
  };
}
export type TalkingPointService = ReturnType<typeof createTalkingPointService>;

// ====================================================================== F10 coverage
function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return toIsoDate(x);
}

export function createCoverageService(d: Deps, book: BookService, alerts: AlertService) {
  const { adapters, db, clock } = d;

  async function computeFor(ctx: UserContext, rmIds: string[]): Promise<CoverageItem[]> {
    const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: rmIds });
    const touch = await book.lastTouch(ctx, accounts.map((a) => a.id));
    const alertCounts = await alerts.countOpenByAccount(rmIds);
    const loans = (await Promise.all(accounts.map((a) => adapters.ncino.getLoans(ctx, a.id)))).flat();
    const referrals = await db.referral.findMany({ where: { accountId: { in: accounts.map((a) => a.id) }, status: { in: ['SUBMITTED', 'ACCEPTED', 'CONTACTED'] } } });
    const today = clock.today();
    return rankCoverage(
      accounts.map((a) => {
        const mats = loans.filter((l) => l.accountId === a.id).map((l) => daysBetween(today, parseDate(l.maturityDate))).filter((n) => n >= 0);
        return {
          accountId: a.id, accountName: a.name, segment: a.segment, tier: a.coverageTier,
          daysSinceTouch: touch[a.id] ?? 365, openAlerts: alertCounts[a.id] ?? 0,
          daysToMaturity: mats.length ? Math.min(...mats) : null,
          referralPending: referrals.some((r) => r.accountId === a.id), revenueBand: a.annualRevenueBand,
        };
      }),
    );
  }

  async function plan(ctx: UserContext): Promise<{ items: CoverageItem[]; plan: CoveragePlan }> {
    const items = await computeFor(ctx, ctx.bookRmIds);
    const weekOf = mondayOf(clock.today());
    const existing = await db.coveragePlan.findUnique({ where: { userId_weekOf: { userId: ctx.rmId, weekOf } } });
    const statuses: Record<string, CoverageItem['planStatus']> = existing ? Object.fromEntries((JSON.parse(existing.itemsJson) as CoverageItem[]).map((i) => [i.accountId, i.planStatus])) : {};
    // 5–15 targets: everything overdue, topped up to 5 with the highest-scoring accounts (F10-FR3).
    const overdue = items.filter((i) => i.overdueBy > 0);
    const chosen = (overdue.length >= 5 ? overdue : [...overdue, ...items.filter((i) => i.overdueBy <= 0).slice(0, 5 - overdue.length)]).slice(0, 15);
    const planItems = chosen.map((i) => ({ ...i, planStatus: statuses[i.accountId] ?? 'SUGGESTED' }));
    const within = items.filter((i) => i.overdueBy <= 0).length;
    const coveragePct = items.length ? Math.round((within / items.length) * 100) : 100;
    const id = existing?.id ?? randomUUID();
    await db.coveragePlan.upsert({
      where: { userId_weekOf: { userId: ctx.rmId, weekOf } },
      create: { id, userId: ctx.rmId, weekOf, itemsJson: JSON.stringify(planItems) },
      update: { itemsJson: JSON.stringify(planItems) },
    });
    return { items, plan: { id, weekOf, items: planItems, coveragePct } };
  }

  async function setStatus(ctx: UserContext, accountId: string, status: CoverageItem['planStatus']) {
    const weekOf = mondayOf(clock.today());
    const row = await db.coveragePlan.findUnique({ where: { userId_weekOf: { userId: ctx.rmId, weekOf } } });
    if (!row) return;
    const items = (JSON.parse(row.itemsJson) as CoverageItem[]).map((i) => (i.accountId === accountId ? { ...i, planStatus: status } : i));
    await db.coveragePlan.update({ where: { id: row.id }, data: { itemsJson: JSON.stringify(items) } });
  }

  return {
    computeFor,
    plan,
    setStatus,
    async action(ctx: UserContext, accountId: string, req: { action: 'ACCEPT' | 'SKIP' | 'SCHEDULE'; reason?: string; slot?: string }): Promise<WriteIntent | { ok: true }> {
      const a = await book.account(ctx, accountId);
      if (req.action === 'SKIP') {
        await setStatus(ctx, accountId, 'SKIPPED');
        await d.audit.record({ userId: ctx.rmId, action: 'coverage.skip', system: 'SHERPA', object: 'CoveragePlan', targetId: accountId, accountId, after: { reason: req.reason ?? null }, requestId: ctx.requestId, at: clock.now() });
        return { ok: true };
      }
      if (req.action === 'ACCEPT') {
        const due = toIsoDate(addDays(clock.today(), 5));
        return d.gateway.createIntent(ctx, 'task.create', {
          accountId, bookRmId: a.ownerRmId, subject: `Reach out to ${a.name}`, dueDate: due, ownerId: ctx.rmId, ownerName: ctx.user.name, coverage: true,
        }, { summary: `Create an outreach task for ${a.name}`, planned: [{ system: 'Salesforce', label: `Task: Reach out to ${a.name}, due ${due}` }] });
      }
      const start = req.slot ? new Date(req.slot) : (() => { const x = addDays(clock.today(), 2); x.setHours(10, 0, 0, 0); return x; })();
      if (Number.isNaN(start.getTime())) throw new AppError('VALIDATION', 'Pick a valid time for the hold.');
      return d.gateway.createIntent(ctx, 'calendar.hold', { accountId, title: `Hold: call ${a.name}`, start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString() }, {
        summary: `Add a calendar hold to call ${a.name}`,
        planned: [{ system: 'Outlook calendar', label: `Hold: call ${a.name}` }],
      });
    },
    /** Leader view: coverage % per RM, no client details (F10-FR5, F10-AC2). */
    async team(ctx: UserContext) {
      assertRole(ctx, 'LEADER');
      const users = await db.user.findMany({ where: { id: { in: [...ctx.teamRmIds] } }, orderBy: { name: 'asc' } });
      return Promise.all(
        users.map(async (u) => {
          const items = await computeFor(ctx, [u.id]);
          const within = items.filter((i) => i.overdueBy <= 0).length;
          return { rmId: u.id, name: u.name, coveragePct: items.length ? Math.round((within / items.length) * 100) : 100, accounts: items.length, overdue: items.length - within };
        }),
      );
    },
  };
}
export type CoverageService = ReturnType<typeof createCoverageService>;

// ====================================================================== F13 health
export const HEALTH_DISCLAIMER = 'Internal early-warning indicator. Not used for credit or pricing decisions.';

export function createHealthService(d: Deps, book: BookService) {
  const { adapters, db, clock } = d;

  async function inputsFor(ctx: UserContext, accountId: string): Promise<{ inputs: HealthInputs; facts: Record<keyof HealthInputs, SourcedFact> }> {
    const today = clock.today();
    const asOf = today.toISOString();
    const [dep, loans, touch, complaints, referrals] = await Promise.all([
      book.depositSummary(ctx, accountId),
      adapters.ncino.getLoans(ctx, accountId),
      book.lastTouch(ctx, [accountId]),
      adapters.salesforce.getOpenCases(ctx, accountId).then((cs) => cs.filter((c) => c.recordType === 'Complaint' && new Date(c.createdAt) >= addDays(today, -365)).length),
      db.referral.count({ where: { accountId, createdAt: { gte: addDays(today, -365) } } }),
    ]);
    const util = await book.utilizationByFacility(ctx, loans);
    const swings = Object.values(util).map((h) => h[h.length - 1].utilization - (h.find((x) => parseDate(x.date) >= addDays(today, -30)) ?? h[0]).utilization);
    const utilChange = swings.length ? swings.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : null;
    const noRenewal = loans.filter((l) => !l.renewalOppOpen).map((l) => daysBetween(today, parseDate(l.maturityDate))).filter((n) => n >= 0);
    const inputs: HealthInputs = {
      depositTrendPct: Math.round(dep.trendPct),
      utilizationChangePts: utilChange === null ? null : Math.round(utilChange),
      daysSinceTouch: touch[accountId],
      complaints12m: complaints,
      referrals12m: referrals,
      productCount: dep.products.length,
      maturityWithoutRenewalDays: noRenewal.length ? Math.min(...noRenewal) : null,
    };
    const facts: Record<keyof HealthInputs, SourcedFact> = {
      depositTrendPct: f('health.deposits', 'Deposit trend vs 90-day average', inputs.depositTrendPct ?? 0, `${(inputs.depositTrendPct ?? 0) >= 0 ? '+' : ''}${inputs.depositTrendPct ?? 0}%`, 'CORE_DEPOSITS', dep.asOf),
      utilizationChangePts: f('health.utilization', 'Utilization change, 30 days', inputs.utilizationChangePts ?? 0, `${inputs.utilizationChangePts ?? 0} pts`, 'ACBS', asOf),
      daysSinceTouch: f('health.touch', 'Days since last touch', inputs.daysSinceTouch ?? 0, `${inputs.daysSinceTouch ?? 'n/a'} days`, 'SALESFORCE', asOf),
      complaints12m: f('health.complaints', 'Complaints, 12 months', complaints, String(complaints), 'SALESFORCE', asOf),
      referrals12m: f('health.referrals', 'Referrals, 12 months', referrals, String(referrals), 'SHERPA', asOf),
      productCount: f('health.products', 'Products held', dep.products.length, String(dep.products.length), 'CORE_DEPOSITS', dep.asOf),
      maturityWithoutRenewalDays: f('health.maturity', 'Days to maturity without renewal', inputs.maturityWithoutRenewalDays ?? 0, inputs.maturityWithoutRenewalDays === null ? 'None' : `${inputs.maturityWithoutRenewalDays} days`, 'NCINO', asOf),
    };
    return { inputs, facts };
  }

  async function compute(ctx: UserContext, accountId: string, withHistory = false): Promise<HealthScore> {
    d.flags.require('F13_HEALTH_SCORE');
    const a = await book.account(ctx, accountId);
    const { inputs, facts } = await inputsFor(ctx, accountId);
    const r = scoreHealth(inputs);
    const now = clock.now();
    const weekKey = mondayOf(clock.today());
    const latest = await db.healthScoreSnapshot.findFirst({ where: { accountId }, orderBy: { computedAt: 'desc' } });
    if (!latest || mondayOf(latest.computedAt) !== weekKey) {
      await db.healthScoreSnapshot.create({ data: { id: randomUUID(), accountId, score: r.score, band: r.band, driversJson: JSON.stringify(r.drivers), computedAt: now } });
    }
    const score: HealthScore = {
      accountId, accountName: a.name, score: r.score, band: r.band,
      drivers: r.drivers.slice(0, 3).map((x) => ({ factor: x.factor, impact: x.impact, fact: facts[x.input] })),
      computedAt: now.toISOString(),
    };
    if (withHistory) {
      const snaps = await db.healthScoreSnapshot.findMany({ where: { accountId }, orderBy: { computedAt: 'asc' }, take: 12 });
      score.history = snaps.map((s) => ({ at: s.computedAt.toISOString(), score: s.score }));
    }
    return score;
  }

  return {
    compute,
    allowlist: HEALTH_INPUT_ALLOWLIST,
    async list(ctx: UserContext, band?: string): Promise<HealthScore[]> {
      d.flags.require('F13_HEALTH_SCORE');
      const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
      const scores = await Promise.all(accounts.map((a) => compute(ctx, a.id)));
      return scores.filter((s) => !band || s.band === band).sort((x, y) => x.score - y.score);
    },
  };
}
export type HealthService = ReturnType<typeof createHealthService>;
