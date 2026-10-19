/** F04 task actions, F05 referrals — each external write through the WriteGateway with confirmation. */
import { randomUUID } from 'node:crypto';
import {
  SPECIALTY_LABEL,
  formatLongDate,
  type Referral,
  type ReferralIntentRequest,
  type RoutePreview,
  type Specialty,
  type Task,
  type TaskActionRequest,
  type WriteIntent,
  type WriteResult,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError, notFound } from '../lib/errors';
import type { WriteSession } from '../write-gateway';
import type { CoverageService } from './insights';
import type { NotificationService } from './compliance';

// ====================================================================== F04 tasks
export function createTaskService(d: Deps, coverage: CoverageService) {
  const { adapters, db } = d;

  async function ownedTask(ctx: UserContext, taskId: string) {
    const t = await adapters.salesforce.getTask(ctx, taskId);
    if (!t || !ctx.bookRmIds.includes(t.bookRmId)) throw notFound('That task');
    return t;
  }

  d.gateway.register('task.update', async (s: WriteSession, payload) => {
    const p = payload as { taskId: string; changes: { status?: 'COMPLETED'; dueDate?: string } };
    const t = await ownedTask(s.ctx as UserContext, p.taskId);
    const r = await s.write({ system: 'SALESFORCE', object: 'Task', action: 'update', accountId: t.accountId, before: { status: t.status, dueDate: t.dueDate } }, () => adapters.salesforce.updateTask(s.ctx, p.taskId, p.changes), (res) => ({ targetId: p.taskId, after: { status: res.after.status, dueDate: res.after.dueDate } }));
    const label = p.changes.status === 'COMPLETED' ? `Marked done: ${r.after.subject}` : `Moved to ${formatLongDate(p.changes.dueDate!)}: ${r.after.subject}`;
    return { written: [{ kind: 'task', label, system: 'Salesforce', externalId: p.taskId }], held: [] };
  });

  d.gateway.register('task.delegate', async (s: WriteSession, payload) => {
    const p = payload as { taskId: string; ownerId: string; ownerName: string };
    if (!s.approved('delegate')) return { written: [], held: [{ kind: 'task', label: 'Delegation', reason: 'Held · not approved' }] };
    const t = await ownedTask(s.ctx as UserContext, p.taskId);
    await s.write({ system: 'SALESFORCE', object: 'Task', action: 'delegate', accountId: t.accountId, before: { ownerName: t.ownerName } }, () => adapters.salesforce.updateTask(s.ctx, p.taskId, { ownerId: p.ownerId, ownerName: p.ownerName }), () => ({ targetId: p.taskId, after: { ownerName: p.ownerName } }));
    return { written: [{ kind: 'task', label: `Delegated to ${p.ownerName}: ${t.subject}`, system: 'Salesforce', externalId: p.taskId }], held: [] };
  });

  d.gateway.register('task.create', async (s: WriteSession, payload) => {
    const p = payload as { accountId: string; bookRmId: string; subject: string; dueDate: string | null; ownerId: string; ownerName: string; alertId?: string; coverage?: boolean };
    assertInBook(s.ctx as UserContext, p.accountId);
    const r = await s.write({ system: 'SALESFORCE', object: 'Task', action: 'create', accountId: p.accountId }, () => adapters.salesforce.createTasks(s.ctx, [{ accountId: p.accountId, bookRmId: p.bookRmId, ownerId: p.ownerId, ownerName: p.ownerName, subject: p.subject, dueDate: p.dueDate, clientCommitment: false }]), (res) => ({ targetId: res.ids[0], after: p }));
    if (p.alertId) await db.alert.update({ where: { id: p.alertId }, data: { status: 'ACKNOWLEDGED' } });
    if (p.coverage) await coverage.setStatus(s.ctx as UserContext, p.accountId, 'ACCEPTED');
    return { written: [{ kind: 'task', label: `Task created: ${p.subject}`, system: 'Salesforce', externalId: r.ids[0] }], held: [] };
  });

  d.gateway.register('calendar.hold', async (s: WriteSession, payload) => {
    const p = payload as { accountId: string; title: string; start: string; end: string };
    assertInBook(s.ctx as UserContext, p.accountId);
    const r = await s.write({ system: 'CALENDAR', object: 'Event', action: 'create.hold', accountId: p.accountId }, () => adapters.calendar.createHold(s.ctx, { accountId: p.accountId, title: p.title, start: new Date(p.start), end: new Date(p.end) }), (res) => ({ targetId: res.id, after: p }));
    await coverage.setStatus(s.ctx as UserContext, p.accountId, 'SCHEDULED');
    return { written: [{ kind: 'calendar', label: `Calendar hold: ${p.title}`, system: 'Outlook calendar', externalId: r.id }], held: [] };
  });

  return {
    async list(ctx: UserContext, filter: { status?: 'OPEN' | 'COMPLETED'; commitment?: boolean }): Promise<Task[]> {
      return adapters.salesforce.getTasks(ctx, { bookRmIds: ctx.bookRmIds, status: filter.status, commitment: filter.commitment });
    },

    async intent(ctx: UserContext, taskId: string, req: TaskActionRequest): Promise<WriteIntent> {
      const t = await ownedTask(ctx, taskId);
      if (req.action === 'COMPLETE') {
        return d.gateway.createIntent(ctx, 'task.update', { taskId, changes: { status: 'COMPLETED' } }, { summary: `Mark "${t.subject}" done`, planned: [{ system: 'Salesforce', label: `Task: ${t.subject} → Completed` }] });
      }
      if (req.action === 'RESCHEDULE') {
        if (!req.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(req.dueDate)) throw new AppError('VALIDATION', 'Pick a new due date.');
        return d.gateway.createIntent(ctx, 'task.update', { taskId, changes: { dueDate: req.dueDate } }, { summary: `Move "${t.subject}" to ${formatLongDate(req.dueDate)}`, planned: [{ system: 'Salesforce', label: `Task: ${t.subject} → due ${req.dueDate}` }] });
      }
      const users = await adapters.salesforce.listUsers(ctx);
      const to = users.find((u) => req.delegateTo && (u.id === req.delegateTo || u.name.toLowerCase().startsWith(req.delegateTo.toLowerCase())));
      if (!to || !['RM', 'ANALYST'].includes(to.role)) throw new AppError('VALIDATION', 'You can delegate to a colleague on your team.');
      // Delegation requires its own explicit confirmation (F04-FR2).
      return d.gateway.createIntent(ctx, 'task.delegate', { taskId, ownerId: to.id, ownerName: to.name }, {
        summary: `Delegate "${t.subject}" to ${to.name}`,
        planned: [{ system: 'Salesforce', label: `Task owner → ${to.name}`, approvalId: 'delegate' }],
        approvals: [{ id: 'delegate', kind: 'TASK_DELEGATE', label: `Delegate to ${to.name}` }],
      });
    },

    async confirm(ctx: UserContext, c: Parameters<typeof d.gateway.execute>[1]): Promise<WriteResult> {
      return d.gateway.execute(ctx, c);
    },

    /** Fuzzy match "the Brightwater docs" / "Castell" to an open task in the book. */
    async findByRef(ctx: UserContext, ref: string): Promise<Task | null> {
      const tasks = await adapters.salesforce.getTasks(ctx, { bookRmIds: ctx.bookRmIds, status: 'OPEN' });
      const words = ref.toLowerCase().replace(/\b(the|a|my|task|docs?)\b/g, (w) => (w.startsWith('doc') ? 'document' : '')).split(/\s+/).filter((w) => w.length > 2);
      const scored = tasks
        .map((t) => {
          const hay = `${t.subject} ${t.accountName ?? ''}`.toLowerCase();
          return { t, score: words.filter((w) => hay.includes(w) || hay.includes(w.replace(/s$/, ''))).length };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || Number(b.t.clientCommitment) - Number(a.t.clientCommitment));
      return scored[0]?.t ?? null;
    },
  };
}
export type TaskService = ReturnType<typeof createTaskService>;

// ====================================================================== F05 referrals
export function createReferralService(d: Deps, notifications: NotificationService) {
  const { adapters, db, clock, routing, log } = d;

  function route(specialty: Specialty, region: string | null, segment: string): RoutePreview {
    const rule = routing.rules.find((r) => r.specialty === specialty && (r.region === '*' || r.region === region) && (r.segment === '*' || r.segment === segment));
    if (!rule) {
      // F05-AC2: no matching rule → default queue + warning.
      log.warn({ specialty, region, segment }, 'referral routing: no matching rule, using default queue');
      return { queue: routing.defaultQueue, fallback: true };
    }
    return { queue: rule.queue, userId: rule.userId, fallback: false };
  }

  d.gateway.register('referral.create', async (s: WriteSession, payload) => {
    const p = payload as ReferralIntentRequest & { route: RoutePreview; accountName: string };
    const ctx = s.ctx as UserContext;
    assertInBook(ctx, p.accountId);
    const fields = {
      accountId: p.accountId, Account__c: p.accountId, Contact__c: p.contactId ?? null, Specialty__c: p.specialty, Need_Summary__c: p.needSummary, Urgency__c: p.urgency,
      Routed_Queue__c: p.route.queue, Routed_User__c: p.route.userId ?? null, Status__c: 'Submitted', Consent_To_Share__c: p.consentToShare, Debrief__c: p.debriefId ?? null,
    };
    const r = await s.write({ system: 'SALESFORCE', object: 'Referral__c', action: 'create', accountId: p.accountId }, () => adapters.salesforce.createReferral(ctx, fields), (res) => ({ targetId: res.id, after: fields }));
    const id = randomUUID();
    await db.referral.create({
      data: { id, userId: ctx.rmId, accountId: p.accountId, contactId: p.contactId ?? null, specialty: p.specialty, needSummary: p.needSummary, urgency: p.urgency, queue: p.route.queue, routedUserId: p.route.userId ?? null, status: 'SUBMITTED', consent: p.consentToShare, salesforceId: r.id, debriefId: p.debriefId ?? null, createdAt: clock.now() },
    });
    await adapters.events.publish(ctx, 'referral.created', { referralId: r.id, queue: p.route.queue });
    if (p.route.userId) await notifications.notify(p.route.userId, { type: 'referral', title: `New ${SPECIALTY_LABEL[p.specialty]} referral`, body: `${p.accountName}: ${p.needSummary}`, dedupeKey: `referral:${r.id}` });
    return { written: [{ kind: 'referral', label: `Referral to ${p.route.queue}`, system: 'Salesforce', externalId: r.id }], held: [] };
  });

  function toReferral(r: Awaited<ReturnType<typeof db.referral.findFirst>> & object, names: Record<string, string>): Referral {
    return {
      id: r.id, accountId: r.accountId, accountName: names[r.accountId] ?? '', contactId: r.contactId ?? undefined, specialty: r.specialty as Specialty, needSummary: r.needSummary,
      urgency: r.urgency as Referral['urgency'], routedTo: { queue: r.queue, userId: r.routedUserId ?? undefined }, status: r.status as Referral['status'],
      consentToShare: r.consent, createdAt: r.createdAt.toISOString(), salesforceId: r.salesforceId ?? undefined,
    };
  }

  return {
    route,
    async preview(ctx: UserContext, accountId: string, specialty: Specialty) {
      assertInBook(ctx, accountId);
      const a = await adapters.salesforce.getAccount(ctx, accountId);
      return route(specialty, ctx.user.region, a?.segment ?? 'COMMERCIAL');
    },
    async list(ctx: UserContext, accountId?: string): Promise<Referral[]> {
      if (accountId) assertInBook(ctx, accountId);
      const rows = await db.referral.findMany({ where: { accountId: accountId ? accountId : { in: [...ctx.bookAccountIds] } }, orderBy: { createdAt: 'desc' } });
      const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
      const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
      return rows.map((r) => toReferral(r, names));
    },
    async intent(ctx: UserContext, req: ReferralIntentRequest): Promise<WriteIntent & { route: RoutePreview }> {
      d.flags.require('F05_REFERRALS');
      assertInBook(ctx, req.accountId);
      if (!req.consentToShare) throw new AppError('VALIDATION', 'Confirm the client agreed to be contacted by a specialist.');
      const a = await adapters.salesforce.getAccount(ctx, req.accountId);
      const r = route(req.specialty, ctx.user.region, a?.segment ?? 'COMMERCIAL');
      const intent = await d.gateway.createIntent(ctx, 'referral.create', { ...req, route: r, accountName: a?.name ?? '' }, {
        summary: `Refer ${a?.name} to ${SPECIALTY_LABEL[req.specialty]}`,
        planned: [{ system: 'Salesforce', label: `Referral to ${r.queue}` }],
      });
      return { ...intent, route: r };
    },
    async prefill(ctx: UserContext, debriefId: string) {
      const deb = await db.debrief.findUnique({ where: { id: debriefId } });
      if (!deb) throw notFound('That debrief');
      assertInBook(ctx, deb.accountId);
      const r = JSON.parse(deb.resultJson) as { draft: { specialistInterest: Specialty[]; summary: string; clientNeeds: string; accountName: string; attendees: { contactId?: string; external: boolean }[] } };
      const specialty = r.draft.specialistInterest[0] ?? null;
      const needSummary = specialty ? await d.model.summarizeNeed(`${r.draft.summary} ${r.draft.clientNeeds}`, specialty, r.draft.accountName) : '';
      return { accountId: deb.accountId, specialties: r.draft.specialistInterest, specialty, needSummary, contactId: r.draft.attendees.find((x) => x.external && x.contactId)?.contactId ?? null };
    },
  };
}
export type ReferralService = ReturnType<typeof createReferralService>;
