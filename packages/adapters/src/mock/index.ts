/**
 * Deterministic mock adapters backed by the dev DB `mock_*` tables (docs/02 §3).
 * Every call is recorded in `mock_call_log` so tests can assert e.g. "no Salesforce write before confirm".
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '@sherpa/db';
import { toIsoDate, type Account, type Contact, type Meeting, type Opportunity, type Task, type User } from '@sherpa/shared';
import {
  UpstreamUnavailableError,
  type ActivityRecord,
  type Adapters,
  type CovenantRecord,
  type LoanRecord,
  type RequestContext,
  type TicklerRecord,
} from '../interfaces';

export interface MockDeps {
  db: Db;
  now: () => Date;
}

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  u_maya: 'Commercial RM · 8 middle-market relationships',
  u_devon: 'Small Business RM · 45 relationships',
  u_priya: 'RM Analyst · supports Maya',
  u_sam: 'Market leader · NJ Central team',
  u_jordan: 'Compliance reviewer',
};

function sfId(prefix: string): string {
  return (prefix + 'Mock' + randomUUID().replace(/-/g, '')).slice(0, 18);
}

export function hashPin(pin: string): string {
  return createHash('sha256').update(`sherpa-pin:${pin}`).digest('hex');
}

export function createMockAdapters({ db, now }: MockDeps): Adapters {
  async function log(adapter: string, method: string, args: unknown) {
    await db.mockCallLog.create({
      data: { id: randomUUID(), adapter, method, argsJson: JSON.stringify(args ?? null), at: now() },
    });
  }
  async function guard(adapter: string) {
    const f = await db.mockSystemFailure.findUnique({ where: { adapter } });
    if (f?.failing) throw new UpstreamUnavailableError(adapter);
  }
  const ctxArgs = (ctx: RequestContext, rest: Record<string, unknown> = {}) => ({ rmId: ctx.rmId, ...rest });

  const toUser = (u: { id: string; name: string; email: string; role: string; segment: string | null; region: string | null; teamId: string | null }): User =>
    ({ id: u.id, name: u.name, email: u.email, role: u.role as User['role'], segment: u.segment as User['segment'], region: u.region, teamId: u.teamId });

  const toAccount = (a: Awaited<ReturnType<Db['mockSfAccount']['findFirst']>> & object): Account => ({
    id: a.id, name: a.name, city: a.city, state: a.state, segment: a.segment as Account['segment'],
    coverageTier: a.tier as Account['coverageTier'], ownerRmId: a.ownerRmId, industry: a.industry,
    annualRevenueBand: a.revenueBand, relationshipSince: a.relationshipSince,
  });

  const toTask = async (t: Awaited<ReturnType<Db['mockSfTask']['findFirst']>> & object): Promise<Task> => {
    const acct = t.accountId ? await db.mockSfAccount.findUnique({ where: { id: t.accountId } }) : null;
    return {
      id: t.id, accountId: t.accountId, accountName: acct?.name ?? null, subject: t.subject, ownerId: t.ownerId,
      ownerName: t.ownerName, dueDate: t.dueDate, status: t.status as Task['status'],
      clientCommitment: t.clientCommitment, debriefId: t.debriefId,
    };
  };

  const toMeeting = (e: Awaited<ReturnType<Db['mockSfEvent']['findFirst']>> & object): Meeting => ({
    id: e.id, accountId: e.accountId, subject: e.subject, start: e.start.toISOString(), end: e.end.toISOString(),
    location: e.location ?? undefined, type: e.type as Meeting['type'], attendees: JSON.parse(e.attendeesJson),
  });

  const toOpp = (o: Awaited<ReturnType<Db['mockSfOpportunity']['findFirst']>> & object): Opportunity => ({
    id: o.id, accountId: o.accountId, name: o.name, amount: o.amount, stage: o.stage, closeDate: o.closeDate,
  });

  const asOfToday = () => toIsoDate(now());

  return {
    // ------------------------------------------------------------------ identity
    identity: {
      async listPersonas() {
        const users = await db.user.findMany({ where: { id: { in: Object.keys(PERSONA_DESCRIPTIONS) } } });
        const order = Object.keys(PERSONA_DESCRIPTIONS);
        return users
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
          .map((u) => ({ ...toUser(u), description: PERSONA_DESCRIPTIONS[u.id] }));
      },
      async signIn(personaId) {
        await log('Identity', 'signIn', { personaId });
        const u = await db.user.findUnique({ where: { id: personaId } });
        if (!u || !PERSONA_DESCRIPTIONS[u.id]) throw new Error('Unknown persona');
        return toUser(u);
      },
      async getUser(userId) {
        const u = await db.user.findUnique({ where: { id: userId } });
        return u ? toUser(u) : null;
      },
      async verifyPhone({ userId, pin, pushApproved }) {
        await log('Identity', 'verifyPhone', { userId, pinProvided: Boolean(pin), pushApproved: Boolean(pushApproved) });
        if (pushApproved === true) return true;
        if (!pin) return false; // caller ID alone is never sufficient (C-12)
        const u = await db.user.findUnique({ where: { id: userId } });
        return Boolean(u?.pinHash && u.pinHash === hashPin(pin));
      },
    },

    // ------------------------------------------------------------------ salesforce
    salesforce: {
      async getAccount(ctx, accountId) {
        await guard('Salesforce');
        await log('Salesforce', 'getAccount', ctxArgs(ctx, { accountId }));
        const a = await db.mockSfAccount.findUnique({ where: { id: accountId } });
        return a ? { ...toAccount(a), profile: JSON.parse(a.profileJson) } : null;
      },
      async listAccounts(ctx, filter) {
        await guard('Salesforce');
        await log('Salesforce', 'listAccounts', ctxArgs(ctx, filter));
        const rows = await db.mockSfAccount.findMany({
          where: {
            ownerRmId: { in: filter.ownerRmIds },
            ...(filter.segment ? { segment: filter.segment } : {}),
          },
          orderBy: { name: 'asc' },
        });
        const q = filter.query?.trim().toLowerCase();
        return rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.city.toLowerCase().includes(q)).map(toAccount);
      },
      async getContacts(ctx, accountId) {
        await guard('Salesforce');
        await log('Salesforce', 'getContacts', ctxArgs(ctx, { accountId }));
        const rows = await db.mockSfContact.findMany({ where: { accountId }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] });
        return rows.map((c): Contact => ({ id: c.id, accountId: c.accountId, name: c.name, title: c.title, email: c.email, phone: c.phone ?? undefined, isPrimary: c.isPrimary }));
      },
      async getActivities(ctx, accountId, limit) {
        await guard('Salesforce');
        await log('Salesforce', 'getActivities', ctxArgs(ctx, { accountId, limit }));
        const rows = await db.mockSfActivity.findMany({ where: { accountId, date: { lte: now() } }, orderBy: { date: 'desc' }, take: limit });
        return rows.map((r): ActivityRecord => ({ id: r.id, accountId: r.accountId, type: r.type as ActivityRecord['type'], subject: r.subject, date: r.date.toISOString() }));
      },
      async getLastTouch(ctx, accountIds) {
        await log('Salesforce', 'getLastTouch', ctxArgs(ctx, { count: accountIds.length }));
        const rows = await db.mockSfActivity.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds }, date: { lte: now() } }, _max: { date: true } });
        const out: Record<string, string | null> = Object.fromEntries(accountIds.map((id) => [id, null]));
        for (const r of rows) out[r.accountId] = r._max.date?.toISOString() ?? null;
        return out;
      },
      async getOpenOpportunities(ctx, accountId) {
        await guard('Salesforce');
        await log('Salesforce', 'getOpenOpportunities', ctxArgs(ctx, { accountId }));
        const rows = await db.mockSfOpportunity.findMany({ where: { accountId, stage: { notIn: ['Closed Won', 'Closed Lost'] } }, orderBy: { createdAt: 'asc' } });
        return rows.map(toOpp);
      },
      async getOpenCases(ctx, accountId) {
        await guard('Salesforce');
        await log('Salesforce', 'getOpenCases', ctxArgs(ctx, { accountId }));
        const rows = await db.mockSfCase.findMany({ where: { accountId, status: { not: 'Closed' } } });
        return rows.map((c) => ({ id: c.id, accountId: c.accountId, contactId: c.contactId ?? undefined, recordType: c.recordType, subject: c.subject, description: c.description, queue: c.queue, createdAt: c.createdAt.toISOString() }));
      },
      async getTasks(ctx, filter) {
        await guard('Salesforce');
        await log('Salesforce', 'getTasks', ctxArgs(ctx, filter));
        const rows = await db.mockSfTask.findMany({
          where: {
            bookRmId: { in: filter.bookRmIds },
            ...(filter.accountId ? { accountId: filter.accountId } : {}),
            ...(filter.status ? { status: filter.status } : {}),
            ...(filter.commitment !== undefined ? { clientCommitment: filter.commitment } : {}),
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        });
        return Promise.all(rows.map(toTask));
      },
      async getTask(ctx, taskId) {
        await log('Salesforce', 'getTask', ctxArgs(ctx, { taskId }));
        const t = await db.mockSfTask.findUnique({ where: { id: taskId } });
        return t ? { ...(await toTask(t)), bookRmId: t.bookRmId } : null;
      },
      async listUsers(ctx) {
        await log('Salesforce', 'listUsers', ctxArgs(ctx));
        return (await db.user.findMany({ orderBy: { name: 'asc' } })).map(toUser);
      },
      async createDebrief(ctx, fields) {
        await guard('Salesforce');
        const id = sfId('a0D');
        await log('Salesforce', 'createDebrief', ctxArgs(ctx, { id, fields }));
        await db.mockSfDebrief.create({ data: { id, accountId: String(fields.Account__c), fieldsJson: JSON.stringify(fields), createdAt: now() } });
        return { id };
      },
      async createAttendees(ctx, debriefId, attendees) {
        const ids = attendees.map(() => sfId('a0E'));
        await log('Salesforce', 'createAttendees', ctxArgs(ctx, { debriefId, count: attendees.length }));
        await db.mockSfDebriefAttendee.createMany({
          data: attendees.map((a, i) => ({ id: ids[i], debriefId, contactId: a.contactId ?? null, userId: a.userId ?? null, name: a.name, role: a.role ?? null })),
        });
        return { ids };
      },
      async createTasks(ctx, tasks) {
        await guard('Salesforce');
        const ids = tasks.map(() => sfId('00T'));
        await log('Salesforce', 'createTasks', ctxArgs(ctx, { tasks }));
        await db.mockSfTask.createMany({
          data: tasks.map((t, i) => ({
            id: ids[i], accountId: t.accountId, bookRmId: t.bookRmId, ownerId: t.ownerId ?? null, ownerName: t.ownerName,
            subject: t.subject, dueDate: t.dueDate, status: 'OPEN', clientCommitment: t.clientCommitment,
            debriefId: t.debriefId ?? null, whatId: t.whatId ?? null, createdAt: now(),
          })),
        });
        return { ids };
      },
      async updateTask(ctx, taskId, changes) {
        await guard('Salesforce');
        const beforeRow = await db.mockSfTask.findUnique({ where: { id: taskId } });
        if (!beforeRow) throw new Error('Task not found');
        await log('Salesforce', 'updateTask', ctxArgs(ctx, { taskId, changes }));
        const afterRow = await db.mockSfTask.update({
          where: { id: taskId },
          data: {
            ...(changes.status ? { status: changes.status, completedAt: changes.status === 'COMPLETED' ? now() : null } : {}),
            ...(changes.dueDate ? { dueDate: changes.dueDate } : {}),
            ...(changes.ownerName ? { ownerName: changes.ownerName, ownerId: changes.ownerId ?? null } : {}),
          },
        });
        return { before: await toTask(beforeRow), after: await toTask(afterRow) };
      },
      async createOpportunity(ctx, opp) {
        await guard('Salesforce');
        const id = sfId('006');
        await log('Salesforce', 'createOpportunity', ctxArgs(ctx, { id, opp }));
        await db.mockSfOpportunity.create({ data: { id, ...opp, createdAt: now() } });
        return { id };
      },
      async updateOpportunity(ctx, id, changes) {
        await guard('Salesforce');
        const before = await db.mockSfOpportunity.findUnique({ where: { id } });
        if (!before) throw new Error('Opportunity not found');
        await log('Salesforce', 'updateOpportunity', ctxArgs(ctx, { id, changes }));
        const after = await db.mockSfOpportunity.update({ where: { id }, data: changes });
        return { before: toOpp(before), after: toOpp(after) };
      },
      async upsertContact(ctx, c) {
        await guard('Salesforce');
        await log('Salesforce', 'upsertContact', ctxArgs(ctx, { contact: { ...c, email: c.email ? '[redacted]' : undefined } }));
        const existing = c.id
          ? await db.mockSfContact.findUnique({ where: { id: c.id } })
          : await db.mockSfContact.findFirst({ where: { accountId: c.accountId, name: c.name } });
        if (existing) {
          await db.mockSfContact.update({ where: { id: existing.id }, data: { ...(c.title ? { title: c.title } : {}), ...(c.email ? { email: c.email } : {}) } });
          return { id: existing.id, created: false };
        }
        const id = sfId('003');
        await db.mockSfContact.create({ data: { id, accountId: c.accountId, name: c.name, title: c.title ?? '', email: c.email ?? '', isPrimary: false } });
        return { id, created: true };
      },
      async updateEvent(ctx, eventId, changes) {
        await guard('Salesforce');
        await log('Salesforce', 'updateEvent', ctxArgs(ctx, { eventId, changes }));
        const e = await db.mockSfEvent.findUnique({ where: { id: eventId } });
        if (!e) return;
        await db.mockSfEvent.update({
          where: { id: eventId },
          data: {
            description: changes.appendDescription ? `${e.description ? e.description + '\n' : ''}${changes.appendDescription}` : e.description,
            debriefId: changes.debriefId ?? e.debriefId,
          },
        });
      },
      async createReferral(ctx, fields) {
        await guard('Salesforce');
        const id = sfId('a0R');
        await log('Salesforce', 'createReferral', ctxArgs(ctx, { id, fields }));
        await db.mockSfReferral.create({ data: { id, accountId: fields.accountId, fieldsJson: JSON.stringify(fields), status: 'SUBMITTED', createdAt: now() } });
        return { id };
      },
      async updateReferral(ctx, id, changes) {
        await log('Salesforce', 'updateReferral', ctxArgs(ctx, { id, changes }));
        await db.mockSfReferral.update({ where: { id }, data: { status: changes.status } });
      },
      async createComplaintCase(ctx, c) {
        await guard('Salesforce');
        const id = sfId('500');
        const queue = 'Complaints – Commercial Banking';
        await log('Salesforce', 'createComplaintCase', ctxArgs(ctx, { id, accountId: c.accountId }));
        await db.mockSfCase.create({
          data: { id, accountId: c.accountId, contactId: c.contactId ?? null, recordType: 'Complaint', subject: c.subject, description: c.description, origin: 'Sherpa', queue, createdAt: now() },
        });
        return { id, queue };
      },
      async logActivity(ctx, a) {
        await log('Salesforce', 'logActivity', ctxArgs(ctx, a));
        await db.mockSfActivity.create({ data: { id: sfId('00T'), accountId: a.accountId, ownerRmId: ctx.rmId, type: a.type, subject: a.subject, date: now() } });
      },
    },

    // ------------------------------------------------------------------ nCino
    ncino: {
      async getLoans(ctx, accountId) {
        await guard('nCino');
        await log('nCino', 'getLoans', ctxArgs(ctx, { accountId }));
        const rows = await db.mockNcinoLoan.findMany({ where: { accountId }, orderBy: { commitment: 'desc' } });
        return rows.map((l): LoanRecord => ({
          id: l.id, accountId: l.accountId, product: l.product, commitment: l.commitment, outstanding: l.outstanding,
          riskRating: l.riskRating, prevRiskRating: l.prevRiskRating, ratingChangedAt: l.ratingChangedAt?.toISOString() ?? null,
          maturityDate: l.maturityDate, renewalOppOpen: l.renewalOppOpen, asOf: asOfToday(),
        }));
      },
      async getCovenants(ctx, accountId) {
        await guard('nCino');
        await log('nCino', 'getCovenants', ctxArgs(ctx, { accountId }));
        const rows = await db.mockNcinoCovenant.findMany({ where: { accountId } });
        return rows.map((c): CovenantRecord => ({ ...c, metric: c.metric as CovenantRecord['metric'], operator: c.operator as CovenantRecord['operator'] }));
      },
      async getTicklers(ctx, accountId) {
        await guard('nCino');
        await log('nCino', 'getTicklers', ctxArgs(ctx, { accountId }));
        const rows = await db.mockNcinoTickler.findMany({ where: { accountId }, orderBy: { dueDate: 'asc' } });
        return rows.map((t): TicklerRecord => ({ id: t.id, accountId: t.accountId, type: t.type, period: t.period, dueDate: t.dueDate, lastRequestedAt: t.lastRequestedAt?.toISOString() ?? null, status: t.status as TicklerRecord['status'] }));
      },
      async getRiskRating(ctx, accountId) {
        await guard('nCino');
        await log('nCino', 'getRiskRating', ctxArgs(ctx, { accountId }));
        const loans = await db.mockNcinoLoan.findMany({ where: { accountId }, orderBy: { riskRating: 'desc' } });
        const l = loans[0];
        return l ? { rating: l.riskRating, previous: l.prevRiskRating, changedAt: l.ratingChangedAt?.toISOString() ?? null } : null;
      },
      async getSpreads(ctx, accountId) {
        await guard('nCino');
        await log('nCino', 'getSpreads', ctxArgs(ctx, { accountId }));
        const rows = await db.mockNcinoSpread.findMany({ where: { accountId }, orderBy: { asOf: 'desc' } });
        return rows.map((s) => ({ accountId: s.accountId, period: s.period, dscr: s.dscr, leverage: s.leverage, asOf: s.asOf }));
      },
      async createDraftRequest(ctx, payload) {
        await guard('nCino');
        const id = `NCD-${randomUUID().slice(0, 8).toUpperCase()}`;
        const status = 'Draft — RM review';
        await log('nCino', 'createDraftRequest', ctxArgs(ctx, { id, payload }));
        await db.mockNcinoDraftRequest.create({ data: { id, accountId: payload.accountId, payloadJson: JSON.stringify(payload), status, createdAt: now() } });
        return { id, status };
      },
      async markTickler(ctx, ticklerId, status) {
        await log('nCino', 'markTickler', ctxArgs(ctx, { ticklerId, status }));
        await db.mockNcinoTickler.update({ where: { id: ticklerId }, data: { status } });
      },
    },

    // ------------------------------------------------------------------ ACBS
    acbs: {
      async getFacilityBalances(ctx, accountId) {
        await guard('ACBS');
        await log('ACBS', 'getFacilityBalances', ctxArgs(ctx, { accountId }));
        const rows = await db.mockAcbsBalanceHistory.findMany({ where: { accountId }, orderBy: { date: 'desc' } });
        const latest = new Map<string, (typeof rows)[number]>();
        for (const r of rows) if (!latest.has(r.facilityId)) latest.set(r.facilityId, r);
        return [...latest.values()].map((r) => ({ facilityId: r.facilityId, outstanding: r.outstanding, commitment: r.commitment, asOf: r.date }));
      },
      async getUtilizationHistory(ctx, facilityId, days) {
        await guard('ACBS');
        await log('ACBS', 'getUtilizationHistory', ctxArgs(ctx, { facilityId, days }));
        const from = toIsoDate(new Date(now().getTime() - days * 86_400_000));
        const rows = await db.mockAcbsBalanceHistory.findMany({ where: { facilityId, date: { gte: from } }, orderBy: { date: 'asc' } });
        return rows.map((r) => ({ date: r.date, utilization: r.commitment ? (r.outstanding / r.commitment) * 100 : 0 }));
      },
    },

    // ------------------------------------------------------------------ Core deposits
    deposits: {
      async getBalances(ctx, accountId) {
        await guard('CoreDeposits');
        await log('CoreDeposits', 'getBalances', ctxArgs(ctx, { accountId }));
        const r = await db.mockDepositBalanceHistory.findFirst({ where: { accountId }, orderBy: { date: 'desc' } });
        return { balance: r?.balance ?? 0, asOf: r?.date ?? asOfToday() };
      },
      async getBalanceHistory(ctx, accountId, days) {
        await guard('CoreDeposits');
        await log('CoreDeposits', 'getBalanceHistory', ctxArgs(ctx, { accountId, days }));
        const from = toIsoDate(new Date(now().getTime() - days * 86_400_000));
        const rows = await db.mockDepositBalanceHistory.findMany({ where: { accountId, date: { gte: from } }, orderBy: { date: 'asc' } });
        return rows.map((r) => ({ date: r.date, balance: r.balance }));
      },
      async getTreasuryProducts(ctx, accountId) {
        await guard('CoreDeposits');
        await log('CoreDeposits', 'getTreasuryProducts', ctxArgs(ctx, { accountId }));
        const rows = await db.mockDepositProduct.findMany({ where: { accountId }, orderBy: { product: 'asc' } });
        return rows.map((r) => ({ product: r.product, since: r.since }));
      },
    },

    // ------------------------------------------------------------------ PrecisionLender
    precisionLender: {
      async getRelationshipProfitability(ctx, accountId) {
        await guard('PrecisionLender');
        await log('PrecisionLender', 'getRelationshipProfitability', ctxArgs(ctx, { accountId }));
        const r = await db.mockPlProfitability.findUnique({ where: { accountId } });
        return r ? { raroc: r.raroc, revenue12m: r.revenue12m, depositSpreadCredit: r.depositSpreadCredit, asOf: r.asOf } : null;
      },
      async getPricingGuidance(ctx, p) {
        await guard('PrecisionLender');
        await log('PrecisionLender', 'getPricingGuidance', ctxArgs(ctx, { dealId: p.dealId }));
        const prof = await db.mockPlProfitability.findUnique({ where: { accountId: p.accountId } });
        // Deterministic toy pricing model — illustrative only.
        const base = 225;
        const riskAdj = (p.riskRating - 4) * 25;
        const termAdj = p.termMonths && p.termMonths > 60 ? 15 : 0;
        const sizeAdj = p.amount >= 5_000_000 ? -10 : p.amount < 500_000 ? 20 : 0;
        const depositCredit = -(prof?.depositSpreadCredit ?? 0);
        const mid = base + riskAdj + termAdj + sizeAdj + depositCredit;
        return {
          spreadBpsRange: [mid - 15, mid + 15],
          feeRange: [0.25, 0.5],
          targetRaroc: 15,
          drivers: [
            { label: 'Base spread for product', impactBps: base },
            { label: `Risk rating ${p.riskRating}`, impactBps: riskAdj },
            ...(termAdj ? [{ label: 'Term over 5 years', impactBps: termAdj }] : []),
            ...(sizeAdj ? [{ label: p.amount >= 5_000_000 ? 'Deal size over $5M' : 'Deal size under $500K', impactBps: sizeAdj }] : []),
            { label: 'Deposit relationship credit', impactBps: depositCredit },
          ],
          rmAuthorityMaxBps: 260,
        };
      },
    },

    // ------------------------------------------------------------------ Calendar
    calendar: {
      async listMeetings(ctx, range) {
        await guard('Calendar');
        await log('Calendar', 'listMeetings', ctxArgs(ctx, { from: range.from.toISOString(), to: range.to.toISOString() }));
        const rows = await db.mockSfEvent.findMany({
          where: { ownerRmId: { in: range.ownerRmIds }, start: { gte: range.from, lt: range.to } },
          orderBy: { start: 'asc' },
        });
        return rows.map(toMeeting);
      },
      async getMeeting(ctx, meetingId) {
        await log('Calendar', 'getMeeting', ctxArgs(ctx, { meetingId }));
        const e = await db.mockSfEvent.findUnique({ where: { id: meetingId } });
        return e ? { ...toMeeting(e), ownerRmId: e.ownerRmId, debriefId: e.debriefId } : null;
      },
      async createHold(ctx, hold) {
        await guard('Calendar');
        const id = `HOLD-${randomUUID().slice(0, 8)}`;
        await log('Calendar', 'createHold', ctxArgs(ctx, { id, title: hold.title, start: hold.start.toISOString() }));
        await db.mockCalendarHold.create({ data: { id, rmId: ctx.rmId, accountId: hold.accountId ?? null, title: hold.title, start: hold.start, end: hold.end, createdAt: now() } });
        return { id };
      },
    },

    // ------------------------------------------------------------------ Mail (drafts only, C-07)
    mail: {
      async createDraft(ctx, m) {
        await guard('Mail');
        const id = `MAIL-${randomUUID().slice(0, 8)}`;
        await log('Mail', 'createDraft', ctxArgs(ctx, { id, toCount: m.to.length, subjectLength: m.subject.length }));
        await db.mockMailDraft.create({
          data: { id, rmId: ctx.rmId, toJson: JSON.stringify(m.to), ccJson: JSON.stringify(m.cc), subject: m.subject, body: m.body, scheduledFor: m.scheduledFor ?? null, createdAt: now() },
        });
        return { id };
      },
    },

    // ------------------------------------------------------------------ News
    news: {
      async getNews(ctx, accountId, days) {
        await guard('News');
        await log('News', 'getNews', ctxArgs(ctx, { accountId, days }));
        const from = toIsoDate(new Date(now().getTime() - days * 86_400_000));
        const rows = await db.mockNews.findMany({ where: { accountId, publishedAt: { gte: from } }, orderBy: { publishedAt: 'desc' } });
        return rows.map((r) => ({ id: r.id, headline: r.headline, outlet: r.outlet, publishedAt: r.publishedAt, summary: r.summary }));
      },
    },

    // ------------------------------------------------------------------ KYC
    kyc: {
      async getRefreshRequirements(ctx, accountId) {
        await guard('KYC');
        await log('KYC', 'getRefreshRequirements', ctxArgs(ctx, { accountId }));
        const rows = await db.mockKycRequirement.findMany({ where: { accountId } });
        return rows.map((r) => ({ id: r.id, type: r.type, dueDate: r.dueDate, status: r.status }));
      },
      async markRequirement(ctx, id, status) {
        await log('KYC', 'markRequirement', ctxArgs(ctx, { id, status }));
        await db.mockKycRequirement.update({ where: { id }, data: { status } });
      },
    },

    // ------------------------------------------------------------------ Push
    push: {
      async send(rmId, pushToken, n) {
        await log('Push', 'send', { rmId, title: n.title, deepLink: n.deepLink, hasToken: Boolean(pushToken) });
        if (pushToken && pushToken.startsWith('ExponentPushToken')) {
          try {
            const res = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: pushToken, title: n.title, body: n.body, data: { url: n.deepLink } }),
            });
            return { delivered: res.ok };
          } catch {
            return { delivered: false };
          }
        }
        return { delivered: true };
      },
    },

    // ------------------------------------------------------------------ Archive (C-11)
    archive: {
      async storeTranscript(ctx, t) {
        const ref = `ARCH-${randomUUID()}`;
        await log('Archive', 'storeTranscript', ctxArgs(ctx, { ref, sessionId: t.sessionId, lines: t.lines.length }));
        await db.mockArchive.create({ data: { ref, content: JSON.stringify(t), createdAt: now() } });
        return { ref };
      },
    },

    // ------------------------------------------------------------------ Telephony (mock harness)
    telephony: (() => {
      const handlers: ((call: { callId: string; callerId: string }) => void)[] = [];
      return {
        onInboundCall(handler: (call: { callId: string; callerId: string }) => void) {
          handlers.push(handler);
        },
        async simulateInboundCall(callerId: string) {
          const callId = `CALL-${randomUUID().slice(0, 8)}`;
          await log('Telephony', 'inboundCall', { callId, callerId });
          handlers.forEach((h) => h({ callId, callerId }));
          return { callId };
        },
      };
    })(),

    // ------------------------------------------------------------------ Events
    events: {
      async publish(ctx, topic, payload) {
        await log('EventBus', topic, ctxArgs(ctx, payload));
      },
    },
  };
}

/** Test/dev helper: make a mock system fail (F02-AC2). */
export async function setMockFailure(db: Db, adapter: string, failing: boolean): Promise<void> {
  await db.mockSystemFailure.upsert({ where: { adapter }, create: { adapter, failing }, update: { failing } });
}
