import type { AccountDetail, AccountSummary, Referral } from '@sherpa/shared';
import { PURPOSE_LABEL, type Purpose } from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { forbidden } from '../lib/errors';
import type { AlertService } from './alerts';
import type { BookService } from './book';
import type { DocumentService, HealthService, TalkingPointService } from './insights';

export function createAccountService(
  d: Deps,
  book: BookService,
  alerts: AlertService,
  docs: DocumentService,
  talking: TalkingPointService,
  health: HealthService,
  referrals: { list(ctx: UserContext, accountId?: string): Promise<Referral[]> },
) {
  const { adapters, db, clock } = d;

  return {
    async list(ctx: UserContext, filter: { query?: string; segment?: string }): Promise<AccountSummary[]> {
      if (!ctx.bookRmIds.length) throw forbidden('Your role does not have a client book.');
      const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds, query: filter.query, segment: filter.segment });
      const [touch, alertCounts, docItems] = await Promise.all([
        book.lastTouch(ctx, accounts.map((a) => a.id)),
        alerts.countOpenByAccount(ctx.bookRmIds),
        docs.list(ctx),
      ]);
      return accounts.map((a) => ({
        ...a,
        lastTouchDays: touch[a.id] ?? null,
        openAlerts: alertCounts[a.id] ?? 0,
        documentsDue: docItems.filter((i) => i.accountId === a.id && i.daysOverdue > 0).length,
      }));
    },

    async detail(ctx: UserContext, accountId: string): Promise<AccountDetail> {
      assertInBook(ctx, accountId);
      const a = await book.account(ctx, accountId);
      const now = clock.now();
      const [contacts, touch, loans, tasks, opportunities, alertList, refs, documents, debriefs, meetings] = await Promise.all([
        adapters.salesforce.getContacts(ctx, accountId),
        book.lastTouch(ctx, [accountId]),
        adapters.ncino.getLoans(ctx, accountId),
        adapters.salesforce.getTasks(ctx, { bookRmIds: ctx.bookRmIds, accountId, status: 'OPEN' }),
        adapters.salesforce.getOpenOpportunities(ctx, accountId),
        d.flags.isActive('F06_WATCHLIST') ? alerts.list(ctx, { accountId, status: 'open' }) : Promise.resolve([]),
        d.flags.isActive('F05_REFERRALS') ? referrals.list(ctx, accountId) : Promise.resolve([]),
        d.flags.isActive('F08_DOC_CHASE') ? docs.itemsFor(ctx, accountId, a.name) : Promise.resolve([]),
        db.debrief.findMany({ where: { accountId }, orderBy: { confirmedAt: 'desc' }, take: 5 }),
        adapters.calendar.listMeetings(ctx, { from: now, to: new Date(now.getTime() + 14 * 86_400_000), ownerRmIds: ctx.bookRmIds }),
      ]);
      let deposits: AccountDetail['deposits'] = [];
      try {
        deposits = (await book.depositSummary(ctx, accountId)).facts;
      } catch {
        deposits = [];
      }
      const talkingPoints = d.flags.isActive('F09_TALKING_POINTS') ? await talking.forAccount(ctx, accountId).catch(() => []) : [];
      const healthScore = d.flags.isActive('F13_HEALTH_SCORE') ? await health.compute(ctx, accountId, true).catch(() => null) : null;
      return {
        account: a,
        overview: book.overviewFacts(a, touch[accountId], now.toISOString()),
        credit: book.creditFacts(loans, clock.today()),
        deposits,
        contacts,
        recentDebriefs: debriefs.map((x) => {
          const r = JSON.parse(x.resultJson) as { draft?: { summary: string; purpose: Purpose; flags?: { complaint?: { flagged: boolean } } } };
          return {
            id: x.id, confirmedAt: x.confirmedAt.toISOString(), summary: r.draft?.summary ?? '',
            purpose: PURPOSE_LABEL[r.draft?.purpose ?? 'OTHER'], complaint: Boolean(r.draft?.flags?.complaint?.flagged),
          };
        }),
        tasks,
        opportunities,
        alerts: alertList,
        referrals: refs,
        documents: documents.filter((x) => x.status === 'OUTSTANDING'),
        talkingPoints,
        health: healthScore,
        upcomingMeeting: meetings.find((m) => m.accountId === accountId) ?? null,
      };
    },
  };
}
export type AccountService = ReturnType<typeof createAccountService>;
