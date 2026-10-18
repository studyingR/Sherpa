/** Compliance review queue (docs/08 §3) and notifications (F04-FR4). */
import { randomUUID } from 'node:crypto';
import { DEFAULT_PREFERENCES, type ComplianceItem, type Notification, type Preferences } from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertRole } from '../auth/entitlements';
import type { Deps } from '../deps';
import { notFound } from '../lib/errors';

export function createComplianceService(d: Deps) {
  const { db, clock } = d;
  return {
    async createItem(i: { type: ComplianceItem['type']; accountId: string; rmId: string; excerpt: string; debriefId: string | null; caseId: string | null }) {
      // Minimal necessary excerpt only (docs/08 §3).
      const excerpt = i.excerpt.length > 280 ? `${i.excerpt.slice(0, 277)}...` : i.excerpt;
      await db.complianceItem.create({ data: { id: randomUUID(), ...i, excerpt, status: 'OPEN', createdAt: clock.now() } });
    },
    async queue(ctx: UserContext, type?: ComplianceItem['type']): Promise<ComplianceItem[]> {
      assertRole(ctx, 'COMPLIANCE');
      const rows = await db.complianceItem.findMany({ where: type ? { type } : {}, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
      const accounts = (await Promise.all([...new Set(rows.map((r) => r.accountId))].map((id) => d.adapters.salesforce.getAccount(ctx, id)))).filter((a) => a !== null);
      const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.rmId) } }, select: { id: true, name: true } });
      return rows.map((r) => ({
        id: r.id, type: r.type as ComplianceItem['type'], accountId: r.accountId, accountName: accounts.find((a) => a.id === r.accountId)?.name ?? '',
        rmId: r.rmId, rmName: users.find((u) => u.id === r.rmId)?.name ?? '', excerpt: r.excerpt, debriefId: r.debriefId, caseId: r.caseId,
        status: r.status as ComplianceItem['status'], resolverNote: r.resolverNote, createdAt: r.createdAt.toISOString(),
      }));
    },
    async resolve(ctx: UserContext, id: string, note: string) {
      assertRole(ctx, 'COMPLIANCE');
      const row = await db.complianceItem.findUnique({ where: { id } });
      if (!row) throw notFound('That review item');
      await db.complianceItem.update({ where: { id }, data: { status: 'RESOLVED', resolverNote: note, resolvedBy: ctx.rmId, resolvedAt: clock.now() } });
      await d.audit.record({ userId: ctx.rmId, action: 'compliance.resolve', system: 'SHERPA', object: 'ComplianceItem', targetId: id, accountId: row.accountId, before: { status: row.status }, after: { status: 'RESOLVED', note }, requestId: ctx.requestId, at: clock.now() });
      return { ok: true };
    },
    async audit(ctx: UserContext, filter: { accountId?: string; rmId?: string }) {
      assertRole(ctx, 'COMPLIANCE');
      return d.audit.query({ accountId: filter.accountId, userId: filter.rmId });
    },
  };
}
export type ComplianceService = ReturnType<typeof createComplianceService>;

// ---------------------------------------------------------------- preferences + notifications
export function readPrefs(json: string): Preferences {
  try {
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(json) as Partial<Preferences>) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function inQuietHours(prefs: Preferences, at: Date): boolean {
  if (!prefs.quietHours.enabled) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const s = minutes(prefs.quietHours.start);
  const e = minutes(prefs.quietHours.end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

export function createNotificationService(d: Deps) {
  const { db, clock, adapters } = d;
  return {
    /**
     * Creates an in-app notification and pushes it unless suppressed: quiet hours, muted type, push off,
     * or a duplicate within 24 h (F04-FR4, F04-AC2). Suppressed items still appear in-app.
     */
    async notify(userId: string, n: { type: string; title: string; body: string; deepLink?: string; dedupeKey?: string }): Promise<Notification | null> {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) return null;
      const prefs = readPrefs(user.prefsJson);
      const now = clock.now();
      if (n.dedupeKey) {
        const dup = await db.notification.findFirst({ where: { userId, dedupeKey: n.dedupeKey, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } });
        if (dup) return null;
      }
      let suppressedReason: string | null = null;
      if (prefs.mutedTypes.includes(n.type)) suppressedReason = 'muted';
      else if (!prefs.channels.push) suppressedReason = 'push off';
      else if (inQuietHours(prefs, now)) suppressedReason = 'quiet hours';
      let sentAt: Date | null = null;
      if (!suppressedReason) {
        await adapters.push.send(userId, user.pushToken, { title: n.title, body: n.body, deepLink: n.deepLink });
        sentAt = now;
      }
      const row = await db.notification.create({
        data: { id: randomUUID(), userId, type: n.type, title: n.title, body: n.body, deepLink: n.deepLink ?? null, dedupeKey: n.dedupeKey ?? null, createdAt: now, sentAt, suppressedReason },
      });
      return toNotification(row);
    },
    async list(ctx: UserContext): Promise<Notification[]> {
      const rows = await db.notification.findMany({ where: { userId: ctx.rmId }, orderBy: { createdAt: 'desc' }, take: 100 });
      return rows.map(toNotification);
    },
    async markRead(ctx: UserContext, id: string) {
      await db.notification.updateMany({ where: { id, userId: ctx.rmId }, data: { readAt: clock.now() } });
      return { ok: true };
    },
  };
}

function toNotification(r: { id: string; type: string; title: string; body: string; deepLink: string | null; createdAt: Date; sentAt: Date | null; suppressedReason: string | null; readAt: Date | null }): Notification {
  return { id: r.id, type: r.type, title: r.title, body: r.body, deepLink: r.deepLink, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, suppressedReason: r.suppressedReason, readAt: r.readAt?.toISOString() ?? null };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
