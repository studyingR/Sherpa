/** F06 — Portfolio watchlist alerts. Rules are deterministic (services/rules.ts). */
import { randomUUID } from 'node:crypto';
import { addDays, type Alert, type AlertActionRequest, type WriteIntent } from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { notFound } from '../lib/errors';
import type { BookService } from './book';
import { evaluateAlertRules } from './rules';

const OPEN_STATES = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'];

export function createAlertService(d: Deps, book: BookService) {
  const { db, adapters, clock } = d;

  async function accountNames(ctx: UserContext): Promise<Record<string, string>> {
    const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
    return Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  }

  function toAlert(r: Awaited<ReturnType<typeof db.alert.findFirst>> & object, names: Record<string, string>): Alert {
    return {
      id: r.id, rmId: r.rmId, accountId: r.accountId, accountName: names[r.accountId] ?? '', rule: r.rule as Alert['rule'],
      severity: r.severity as Alert['severity'], title: r.title, evidence: JSON.parse(r.evidenceJson),
      suggestedAction: r.suggestedAction, status: r.status as Alert['status'],
      snoozeUntil: r.snoozeUntil?.toISOString(), createdAt: r.createdAt.toISOString(),
    };
  }

  /** Snoozed alerts reappear once the snooze period ends (F06-AC2). */
  async function wakeSnoozed(rmIds: string[]) {
    await db.alert.updateMany({ where: { rmId: { in: rmIds }, status: 'SNOOZED', snoozeUntil: { lte: clock.now() } }, data: { status: 'OPEN', snoozeUntil: null } });
  }

  /** Evaluate every account in an RM's book (nightly job and on-demand refresh). */
  async function evaluateForRm(ctx: UserContext, rmId: string): Promise<{ created: number; updated: number }> {
    const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: [rmId] });
    let created = 0;
    let updated = 0;
    for (const a of accounts) {
      const [loans, covenants, spreads, ticklers] = await Promise.all([
        adapters.ncino.getLoans(ctx, a.id),
        adapters.ncino.getCovenants(ctx, a.id),
        adapters.ncino.getSpreads(ctx, a.id),
        adapters.ncino.getTicklers(ctx, a.id),
      ]);
      const [utilization, deposits] = await Promise.all([
        book.utilizationByFacility(ctx, loans),
        adapters.deposits.getBalanceHistory(ctx, a.id, 90),
      ]);
      const candidates = evaluateAlertRules({ accountId: a.id, accountName: a.name, today: clock.today(), loans, covenants, spreads, ticklers, utilization, deposits });
      for (const c of candidates) {
        const dedupeKey = `${c.rule}:${c.facilityId}`;
        // Same rule + facility does not re-alert while open (F06-FR4).
        const existing = await db.alert.findFirst({ where: { rmId, dedupeKey, status: { in: OPEN_STATES } } });
        if (existing) {
          await db.alert.update({ where: { id: existing.id }, data: { evidenceJson: JSON.stringify(c.evidence), title: c.title } });
          updated++;
          continue;
        }
        // A dismissed alert stays quiet for 30 days before the same condition can raise it again.
        const dismissedRecently = await db.alert.findFirst({ where: { rmId, dedupeKey, status: { in: ['DISMISSED', 'RESOLVED'] }, updatedAt: { gte: addDays(clock.now(), -30) } } });
        if (dismissedRecently) continue;
        await db.alert.create({
          data: {
            id: randomUUID(), rmId, accountId: a.id, facilityId: c.facilityId, rule: c.rule, severity: c.severity, title: c.title,
            evidenceJson: JSON.stringify(c.evidence), suggestedAction: c.suggestedAction, status: 'OPEN', dedupeKey, createdAt: clock.now(),
          },
        });
        created++;
      }
    }
    return { created, updated };
  }

  return {
    evaluateForRm,

    async refresh(ctx: UserContext) {
      let created = 0;
      let updated = 0;
      for (const rmId of ctx.bookRmIds) {
        const r = await evaluateForRm(ctx, rmId);
        created += r.created;
        updated += r.updated;
      }
      return { created, updated };
    },

    async list(ctx: UserContext, filter: { status?: 'open' | 'snoozed' | 'all'; accountId?: string } = {}): Promise<Alert[]> {
      await wakeSnoozed(ctx.bookRmIds);
      const status = filter.status ?? 'open';
      const rows = await db.alert.findMany({
        where: {
          rmId: { in: ctx.bookRmIds },
          ...(filter.accountId ? { accountId: filter.accountId } : {}),
          ...(status === 'open' ? { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } : status === 'snoozed' ? { status: 'SNOOZED' } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      const rank = { CRITICAL: 0, WARN: 1, INFO: 2 } as Record<string, number>;
      const names = await accountNames(ctx);
      const alerts = rows.map((r) => toAlert(r, names));
      return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.accountName.localeCompare(b.accountName));
    },

    async act(ctx: UserContext, id: string, req: AlertActionRequest): Promise<Alert | WriteIntent> {
      const row = await db.alert.findUnique({ where: { id } });
      if (!row || !ctx.bookRmIds.includes(row.rmId)) throw notFound('That alert');
      assertInBook(ctx, row.accountId);
      if (req.action === 'CREATE_TASK') {
        const acct = await adapters.salesforce.getAccount(ctx, row.accountId);
        return d.gateway.createIntent(ctx, 'task.create', {
          accountId: row.accountId, bookRmId: row.rmId, subject: row.suggestedAction.replace(/\.$/, ''), dueDate: null,
          ownerId: ctx.rmId, ownerName: ctx.user.name, alertId: row.id,
        }, {
          summary: `Create a task for ${acct?.name ?? 'this account'}`,
          planned: [{ system: 'Salesforce', label: `Task: ${row.suggestedAction.replace(/\.$/, '')}` }],
        });
      }
      const now = clock.now();
      const data =
        req.action === 'ACK' ? { status: 'ACKNOWLEDGED' }
        : req.action === 'SNOOZE' ? { status: 'SNOOZED', snoozeUntil: addDays(now, req.snoozeDays ?? 7) }
        : { status: 'DISMISSED', dismissReason: req.reason ?? null };
      const before = { status: row.status };
      const updated = await db.alert.update({ where: { id }, data });
      // Alert actions are audited (F06-FR3).
      await d.audit.record({ userId: ctx.rmId, action: `alert.${req.action.toLowerCase()}`, system: 'SHERPA', object: 'Alert', targetId: id, accountId: row.accountId, before, after: data, requestId: ctx.requestId, at: now });
      return toAlert(updated, await accountNames(ctx));
    },

    async countOpenByAccount(rmIds: string[]): Promise<Record<string, number>> {
      const rows = await db.alert.groupBy({ by: ['accountId'], where: { rmId: { in: rmIds }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: true });
      return Object.fromEntries(rows.map((r) => [r.accountId, r._count]));
    },
  };
}
export type AlertService = ReturnType<typeof createAlertService>;
