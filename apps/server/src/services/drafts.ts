/**
 * F03 follow-up drafting + F08 document requests. Client drafts are built from client-safe fields by
 * construction, then scanned for internal-only content and commitment language (C-04, C-06).
 * Drafts are saved to the RM's mailbox via MailAdapter.createDraft. Nothing is ever sent (C-07).
 */
import { randomUUID } from 'node:crypto';
import { applyCommitmentGuard, scanInternalOnly } from '@sherpa/agent';
import {
  DOCUMENT_TYPE_LABEL,
  PURPOSE_LABEL,
  SPECIALTY_LABEL,
  addDays,
  firstName,
  toIsoDate,
  type DebriefDraft,
  type FollowUpDraft,
  type GuardResult,
  type Recipient,
  type Specialty,
  type WriteIntent,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError, conflict, notFound } from '../lib/errors';
import type { DebriefService } from './debrief';
import type { DocumentService } from './insights';
import type { WriteSession } from '../write-gateway';

const DISCUSSED: Record<Specialty, string> = {
  FX: 'Paying international suppliers and managing currency exposure',
  TREASURY_MANAGEMENT: 'Your treasury and payment services',
  WEALTH: 'Personal wealth and retirement planning',
  SBA: 'SBA financing options',
  CAPITAL_MARKETS: 'Managing interest rate exposure',
  EQUIPMENT_FINANCE: 'Financing for new equipment',
  MERCHANT_SERVICES: 'Accepting card payments',
};

const TEAM_PARTNER: Record<string, string> = {
  'Treasury Services': 'u_omar',
  'FX Desk': 'u_carla',
  'Equipment Finance': 'u_lena_tm',
};
const SPECIALTY_TEAM: Partial<Record<Specialty, string>> = {
  FX: 'FX Desk',
  TREASURY_MANAGEMENT: 'Treasury Services',
  EQUIPMENT_FINANCE: 'Equipment Finance',
};

export function guard(body: string, clientFacing: boolean): { body: string; result: GuardResult } {
  let removedInternal: GuardResult['removed'] = [];
  let text = body;
  if (clientFacing) {
    const scanned = scanInternalOnly(text);
    text = scanned.body;
    removedInternal = scanned.removed;
  } else {
    // Internal notes may carry complaint context but never MNPI (C-04).
    const scanned = scanInternalOnly(text);
    const mnpiOnly = scanned.removed.filter((r) => r.reason === 'non-public information');
    for (const r of mnpiOnly) text = text.replace(r.phrase, '').replace(/ {2,}/g, ' ');
    removedInternal = mnpiOnly;
  }
  const { body: out, result } = applyCommitmentGuard(text);
  const removed = [...removedInternal, ...result.removed];
  const commitmentCount = result.removed.length;
  return {
    body: out,
    result: {
      passed: removed.length === 0,
      removed,
      message: commitmentCount
        ? `We removed ${commitmentCount} phrase${commitmentCount === 1 ? '' : 's'} that could read as commitments`
        : removedInternal.length
          ? `We removed ${removedInternal.length} internal-only phrase${removedInternal.length === 1 ? '' : 's'}`
          : 'Commitment check passed',
    },
  };
}

export function createDraftService(d: Deps, debriefs: DebriefService, docs: DocumentService) {
  const { db, adapters, clock, model, flags } = d;

  function toDraft(r: Awaited<ReturnType<typeof db.followUpDraft.findFirst>> & object): FollowUpDraft {
    return {
      id: r.id, debriefId: r.debriefId, accountId: r.accountId, kind: r.kind as FollowUpDraft['kind'], team: r.team ?? undefined,
      to: JSON.parse(r.toJson), cc: JSON.parse(r.ccJson), subject: r.subject, body: r.editedBody ?? r.body,
      guardResult: JSON.parse(r.guardResultJson), mailDraftId: r.mailDraftId, status: r.status as FollowUpDraft['status'],
      reminderDays: r.reminderJson ? JSON.parse(r.reminderJson) : undefined,
    };
  }

  async function store(ctx: UserContext, input: Omit<FollowUpDraft, 'id' | 'mailDraftId' | 'status'>, original: string): Promise<FollowUpDraft> {
    const row = await db.followUpDraft.create({
      data: {
        id: randomUUID(), debriefId: input.debriefId, accountId: input.accountId, userId: ctx.rmId, kind: input.kind, team: input.team ?? null,
        toJson: JSON.stringify(input.to), ccJson: JSON.stringify(input.cc), subject: input.subject, body: input.body, originalBody: original,
        guardResultJson: JSON.stringify(input.guardResult), status: 'DRAFT', reminderJson: input.reminderDays ? JSON.stringify(input.reminderDays) : null, createdAt: clock.now(),
      },
    });
    return toDraft(row);
  }

  async function loadOwned(ctx: UserContext, id: string) {
    const row = await db.followUpDraft.findUnique({ where: { id } });
    if (!row || row.userId !== ctx.rmId) throw notFound('That draft');
    assertInBook(ctx, row.accountId);
    return row;
  }

  /** Recipients only from Salesforce Contact/User records (F03-FR3). */
  async function allowedRecipients(ctx: UserContext, accountId: string): Promise<Recipient[]> {
    const [contacts, users] = await Promise.all([adapters.salesforce.getContacts(ctx, accountId), adapters.salesforce.listUsers(ctx)]);
    return [
      ...contacts.map((c) => ({ name: c.name, email: c.email, contactId: c.id })),
      ...users.map((u) => ({ name: u.name, email: u.email, userId: u.id })),
    ];
  }

  async function executeMail(s: WriteSession, payload: unknown) {
    const p = payload as { followUpDraftId: string; reminders?: { days: number; subject: string; body: string }[] };
    const row = await db.followUpDraft.findUnique({ where: { id: p.followUpDraftId } });
    if (!row) throw notFound('That draft');
    const ctx = s.ctx as UserContext;
    assertInBook(ctx, row.accountId);
    const message = { to: JSON.parse(row.toJson), cc: JSON.parse(row.ccJson), subject: row.subject, body: row.editedBody ?? row.body };
    const r = await s.write({ system: 'SHERPA', object: 'OutlookDraft', action: 'mail.createDraft', accountId: row.accountId }, () => adapters.mail.createDraft(ctx, message), (res) => ({ targetId: res.id, after: { subject: row.subject } }));
    const written = [{ kind: 'mail', label: 'In your Outlook drafts · not sent', system: 'Outlook', externalId: r.id }];
    for (const rem of p.reminders ?? []) {
      const when = toIsoDate(addDays(clock.today(), rem.days));
      const rr = await s.write({ system: 'SHERPA', object: 'OutlookDraft', action: 'mail.createDraft.reminder', accountId: row.accountId }, () => adapters.mail.createDraft(ctx, { ...message, subject: rem.subject, body: rem.body, scheduledFor: when }), (res) => ({ targetId: res.id }));
      written.push({ kind: 'mail', label: `Reminder draft for ${when} · not sent`, system: 'Outlook', externalId: rr.id });
    }
    await db.followUpDraft.update({ where: { id: row.id }, data: { status: 'SAVED_TO_MAILBOX', mailDraftId: r.id } });
    return { written, held: [], resultRef: r.id };
  }
  d.gateway.register('mail.draft', executeMail);

  return {
    allowedRecipients,

    async fromDebrief(ctx: UserContext, debriefId: string, kinds: ('CLIENT' | 'INTERNAL')[]): Promise<FollowUpDraft[]> {
      flags.require('F03_DRAFTS');
      const detail = await debriefs.detail(ctx, debriefId);
      const draft: DebriefDraft = detail.draft;
      const existing = await db.followUpDraft.findMany({ where: { debriefId, userId: ctx.rmId }, orderBy: { createdAt: 'asc' } });
      const out: FollowUpDraft[] = existing.filter((e) => kinds.includes(e.kind as 'CLIENT' | 'INTERNAL')).map(toDraft);
      const has = (k: string) => existing.some((e) => e.kind === k);
      const contacts = await adapters.salesforce.getContacts(ctx, draft.accountId);

      if (kinds.includes('CLIENT') && !has('CLIENT')) {
        const attendeeContacts = draft.attendees.filter((a) => a.external && a.contactId).map((a) => contacts.find((c) => c.id === a.contactId)).filter((c) => c !== undefined);
        const to = (attendeeContacts.length ? attendeeContacts : contacts.filter((c) => c.isPrimary)).map((c) => ({ name: c.name, email: c.email, contactId: c.id }));
        if (!to.length) throw new AppError('VALIDATION', 'This account has no client contacts in Salesforce to address the recap to.');
        const discussed = [
          ...draft.opportunities.map((o) => `Your plans for ${o.product.toLowerCase()}${/expan/i.test(draft.clientNeeds) ? ' as you expand' : ''}`),
          ...draft.specialistInterest.filter((s) => !(s === 'EQUIPMENT_FINANCE' && draft.opportunities.some((o) => /equipment/i.test(o.product)))).map((s) => DISCUSSED[s]),
        ];
        const steps = draft.nextSteps.filter((s) => s.include).map((s) => ({ title: s.title, ownerType: s.ownerType, ownerName: s.ownerName, dueDate: s.dueDate }));
        const gen = await model.draftClientRecap({ rmName: ctx.user.name, accountName: draft.accountName, recipientFirstName: firstName(to[0].name), purposeLabel: PURPOSE_LABEL[draft.purpose], discussed, nextSteps: steps });
        const g = guard(gen.body, true);
        out.push(await store(ctx, { debriefId, accountId: draft.accountId, kind: 'CLIENT', to, cc: [], subject: gen.subject, body: g.body, guardResult: g.result }, gen.body));
      }

      if (kinds.includes('INTERNAL') && !has('INTERNAL')) {
        const teams = new Map<string, { title: string; dueDate: string | null }[]>();
        for (const s of draft.nextSteps.filter((x) => x.include && x.ownerType === 'TEAM')) teams.set(s.ownerName, [...(teams.get(s.ownerName) ?? []), { title: s.title, dueDate: s.dueDate }]);
        for (const sp of draft.specialistInterest) {
          const team = SPECIALTY_TEAM[sp];
          if (team && !teams.has(team)) teams.set(team, [{ title: `Reach out about ${SPECIALTY_LABEL[sp]} needs`, dueDate: null }]);
        }
        const users = await adapters.salesforce.listUsers(ctx);
        // Need to know: complaint context goes only to teams with a follow-up step, never to specialists generally.
        const background = draft.summary.split(/(?<=\.)\s/).filter((x) => !/complain|frustrat|unhappy|escalat/i.test(x)).slice(0, 2).join(' ');
        const complaintNote = draft.flags.complaint.flagged ? `The client raised ${draft.flags.complaint.summary?.replace(/^Client raised /, '').replace(/\.$/, '')}; it is logged as a complaint.` : '';
        for (const [team, asks] of teams) {
          const ownsFollowUp = draft.nextSteps.some((x) => x.include && x.ownerType === 'TEAM' && x.ownerName === team);
          const context = [background, ownsFollowUp ? complaintNote : ''].filter(Boolean).join(' ');
          const partner = users.find((u) => u.id === TEAM_PARTNER[team]);
          if (!partner) continue;
          const gen = await model.draftInternalHandoff({ rmName: ctx.user.name, accountName: draft.accountName, team, context, asks });
          const g = guard(gen.body, false);
          out.push(await store(ctx, { debriefId, accountId: draft.accountId, kind: 'INTERNAL', team, to: [{ name: partner.name, email: partner.email, userId: partner.id }], cc: [], subject: gen.subject, body: g.body, guardResult: g.result }, gen.body));
        }
      }
      return out;
    },

    async list(ctx: UserContext, debriefId: string): Promise<FollowUpDraft[]> {
      const rows = await db.followUpDraft.findMany({ where: { debriefId, userId: ctx.rmId }, orderBy: { createdAt: 'asc' } });
      return rows.map(toDraft);
    },

    /** Edits re-run the guard; edit pairs are kept for tone learning (no training in this build, F03-FR7). */
    async patch(ctx: UserContext, id: string, p: { subject?: string; body?: string; to?: string[]; cc?: string[] }): Promise<FollowUpDraft> {
      const row = await loadOwned(ctx, id);
      if (row.status === 'SAVED_TO_MAILBOX') throw conflict('This draft is already in your Outlook drafts.');
      const clientFacing = row.kind === 'CLIENT';
      const g = p.body !== undefined ? guard(p.body, clientFacing) : null;
      const allowed = await allowedRecipients(ctx, row.accountId);
      const pick = (emails: string[] | undefined) => {
        if (!emails) return undefined;
        const chosen = emails.map((e) => allowed.find((a) => a.email.toLowerCase() === e.toLowerCase()));
        if (chosen.some((c) => !c)) throw new AppError('VALIDATION', 'Recipients must be Salesforce contacts or bank users.');
        return chosen as Recipient[];
      };
      const to = pick(p.to);
      const cc = pick(p.cc);
      const updated = await db.followUpDraft.update({
        where: { id },
        data: {
          ...(p.subject !== undefined ? { subject: p.subject } : {}),
          ...(g ? { editedBody: g.body, guardResultJson: JSON.stringify(g.result) } : {}),
          ...(to ? { toJson: JSON.stringify(to) } : {}),
          ...(cc ? { ccJson: JSON.stringify(cc) } : {}),
        },
      });
      return toDraft(updated);
    },

    async intent(ctx: UserContext, id: string): Promise<WriteIntent> {
      const row = await loadOwned(ctx, id);
      const draft = toDraft(row);
      if (!draft.to.length) throw new AppError('VALIDATION', 'Add at least one recipient.');
      const reminders = (draft.reminderDays ?? []).map((days) => ({ days, subject: `Reminder: ${draft.subject}`, body: draft.body.replace(/^(Hi [^,]+,\n\n)/, '$1A friendly reminder about the request below.\n\n') }));
      return d.gateway.createIntent(ctx, 'mail.draft', { followUpDraftId: id, reminders }, {
        summary: 'Save to your Outlook drafts. Nothing is sent.',
        planned: [{ system: 'Outlook', label: `Draft: ${draft.subject}` }, ...reminders.map((r) => ({ system: 'Outlook', label: `Reminder draft in ${r.days} days` }))],
      });
    },

    /** F08: one consolidated request per account, drafted through the same guardrails. */
    async documentRequest(ctx: UserContext, accountId: string, itemIds: string[], reminderDays?: number[]): Promise<FollowUpDraft> {
      flags.require('F08_DOC_CHASE');
      assertInBook(ctx, accountId);
      const acct = await adapters.salesforce.getAccount(ctx, accountId);
      const items = (await docs.itemsFor(ctx, accountId, acct?.name ?? '')).filter((i) => itemIds.includes(i.id));
      if (!items.length) throw new AppError('VALIDATION', 'Select at least one document.');
      const contacts = await adapters.salesforce.getContacts(ctx, accountId);
      const to = contacts.filter((c) => c.isPrimary).map((c) => ({ name: c.name, email: c.email, contactId: c.id }));
      const gen = await model.draftDocumentRequest({
        rmName: ctx.user.name, accountName: acct?.name ?? '', recipientFirstName: firstName(to[0]?.name ?? 'there'),
        items: items.map((i) => ({ label: DOCUMENT_TYPE_LABEL[i.type], period: i.period, dueDate: i.dueDate, daysOverdue: i.daysOverdue })),
      });
      const g = guard(gen.body, true);
      const draft = await store(ctx, { debriefId: null, accountId, kind: 'CLIENT', to, cc: [], subject: gen.subject, body: g.body, guardResult: g.result, reminderDays }, gen.body);
      await db.documentRequest.create({ data: { id: randomUUID(), userId: ctx.rmId, accountId, itemsJson: JSON.stringify(itemIds), followUpDraftId: draft.id, reminderScheduleJson: JSON.stringify(reminderDays ?? []), createdAt: clock.now() } });
      return draft;
    },
  };
}
export type DraftService = ReturnType<typeof createDraftService>;
