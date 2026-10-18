/**
 * F01 — Post-meeting debrief. Sessions, autosaved drafts (every turn), chat turns through the agent
 * state machine, review edits, WriteIntent, and the `debrief.save` executor behind the WriteGateway.
 */
import { randomUUID } from 'node:crypto';
import {
  approvalQuestion,
  debriefTurn,
  newDebriefDraft,
  openingLine,
  quarterEndDate,
  type DebriefContext,
  type DebriefTurnResult,
} from '@sherpa/agent';
import {
  PURPOSE_LABEL,
  SPECIALTY_LABEL,
  firstName,
  formatMoney,
  formatShortDate,
  formatTime,
  type AgentMessage,
  type AgentTurn,
  type ApprovalItem,
  type Confirmation,
  type DebriefDetail,
  type DebriefDraft,
  type DebriefDraftPatch,
  type PlannedWrite,
  type StartDebriefRequest,
  type StartDebriefResponse,
  type UiAction,
  type WriteIntent,
  type WriteResult,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError, conflict, forbidden, notFound } from '../lib/errors';
import type { BriefService } from './brief';
import type { ComplianceService } from './compliance';
import type { ExecutorResult, WriteSession } from '../write-gateway';

const RECENT_MEETING_HOURS = 8;

/** Extra transcript held outside the DB until confirmation (live listening, F11-FR3). */
export type TranscriptSource = (sessionId: string) => { speaker: 'RM' | 'AGENT'; text: string; at: string }[] | null;

export function createDebriefService(d: Deps, brief: BriefService, compliance: ComplianceService) {
  const { db, adapters, clock, model, flags } = d;
  const transcriptSources: TranscriptSource[] = [];

  // ------------------------------------------------------------------ persistence helpers
  async function loadDraft(ctx: UserContext, draftId: string): Promise<DebriefDraft> {
    const row = await db.debriefDraft.findUnique({ where: { id: draftId } });
    if (!row || row.userId !== ctx.rmId) throw notFound('That debrief draft');
    return JSON.parse(row.draftJson) as DebriefDraft;
  }

  async function saveDraft(draft: DebriefDraft): Promise<void> {
    await db.debriefDraft.update({
      where: { id: draft.id },
      data: { draftJson: JSON.stringify(draft), status: draft.status, accountId: draft.accountId, meetingId: draft.meetingId },
    });
  }

  async function appendTranscript(sessionId: string, speaker: 'RM' | 'AGENT', text: string, kind?: string): Promise<AgentMessage> {
    const at = clock.now();
    const id = randomUUID();
    await db.transcriptSegment.create({ data: { id, voiceSessionId: sessionId, speaker, text, kind: kind ?? null, startedAt: at, final: true } });
    return { id, speaker, text, kind: (kind as AgentMessage['kind']) ?? 'TEXT', at: at.toISOString() };
  }

  async function transcript(sessionId: string): Promise<AgentMessage[]> {
    const rows = await db.transcriptSegment.findMany({ where: { voiceSessionId: sessionId }, orderBy: { startedAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, speaker: r.speaker as 'RM' | 'AGENT', text: r.text, kind: (r.kind as AgentMessage['kind']) ?? 'TEXT', at: r.startedAt.toISOString() }));
  }

  async function buildContext(ctx: UserContext, draft: DebriefDraft): Promise<DebriefContext> {
    const meeting = draft.meetingId ? await adapters.calendar.getMeeting(ctx, draft.meetingId) : null;
    const [contacts, users, opps, account] = await Promise.all([
      draft.accountId ? adapters.salesforce.getContacts(ctx, draft.accountId) : Promise.resolve([]),
      adapters.salesforce.listUsers(ctx),
      draft.accountId ? adapters.salesforce.getOpenOpportunities(ctx, draft.accountId) : Promise.resolve([]),
      draft.accountId ? adapters.salesforce.getAccount(ctx, draft.accountId) : Promise.resolve(null),
    ]);
    const owner = account ? users.find((u) => u.id === account.ownerRmId) : null;
    return {
      accountId: draft.accountId,
      accountName: draft.accountName,
      rm: owner && ctx.user.role === 'ANALYST' ? { id: owner.id, name: owner.name } : { id: ctx.rmId, name: ctx.user.name },
      meetingDate: meeting ? new Date(meeting.start) : clock.now(),
      meetingSubject: meeting?.subject ?? null,
      attendees: draft.attendees,
      contacts: contacts.map((c) => ({ id: c.id, name: c.name, title: c.title })),
      users: users.filter((u) => !['PARTNER'].includes(u.role as string)).map((u) => ({ id: u.id, name: u.name })),
      openOpportunities: opps.map((o) => ({ id: o.id, name: o.name, product: o.name.split(' – ')[1] ?? null })),
    };
  }

  async function attendeesFor(ctx: UserContext, meeting: { attendees: { name: string; contactId?: string; userId?: string; external: boolean }[] } | null, accountId: string) {
    if (!meeting) return [{ name: ctx.user.name, userId: ctx.rmId, external: false }];
    const contacts = accountId ? await adapters.salesforce.getContacts(ctx, accountId) : [];
    return meeting.attendees.map((a) => ({
      name: a.name, contactId: a.contactId, userId: a.userId, external: a.external,
      role: a.contactId ? contacts.find((c) => c.id === a.contactId)?.title : undefined,
    }));
  }

  /** find_recent_meetings: ended within 8 h, external attendee, not yet debriefed (F01-FR1). */
  async function recentMeetings(ctx: UserContext) {
    const now = clock.now();
    const list = await adapters.calendar.listMeetings(ctx, { from: new Date(now.getTime() - RECENT_MEETING_HOURS * 3600_000 - 3 * 3600_000), to: now, ownerRmIds: ctx.bookRmIds });
    const ended = list.filter((m) => new Date(m.end) <= now && new Date(m.end) >= new Date(now.getTime() - RECENT_MEETING_HOURS * 3600_000) && m.attendees.some((a) => a.external) && m.accountId);
    const out = [];
    for (const m of ended.reverse()) {
      const full = await adapters.calendar.getMeeting(ctx, m.id);
      if (!full?.debriefId) out.push(m);
    }
    return out;
  }

  // ------------------------------------------------------------------ intent
  function plannedFor(draft: DebriefDraft): { planned: PlannedWrite[]; approvals: ApprovalItem[] } {
    const planned: PlannedWrite[] = [{ system: 'Salesforce', label: 'Meeting debrief record' }];
    const approvals: ApprovalItem[] = [];
    for (const s of draft.nextSteps.filter((x) => x.include)) planned.push({ system: 'Salesforce', label: `Task: ${s.title}` });
    for (const o of draft.opportunities) {
      const id = `opp:${o.id}`;
      approvals.push({ id, kind: o.isNew ? 'OPPORTUNITY_CREATE' : 'OPPORTUNITY_UPDATE', label: `${o.isNew ? 'Create' : 'Update'} ${o.product} opportunity${o.amount ? ` (${formatMoney(o.amount)})` : ''}` });
      planned.push({ system: 'Salesforce', label: `Opportunity: ${o.product}${o.amount ? ` ${formatMoney(o.amount)}` : ''}`, approvalId: id });
    }
    for (const c of draft.contactUpdates) {
      const id = `contact:${c.name}`;
      approvals.push({ id, kind: 'CONTACT_UPSERT', label: `Update contact ${c.name}${c.title ? ` (${c.title})` : ''}` });
      planned.push({ system: 'Salesforce', label: `Contact: ${c.name}`, approvalId: id });
    }
    if (draft.meetingId) planned.push({ system: 'Salesforce', label: 'Meeting event summary' });
    if (draft.flags.complaint.flagged) planned.push({ system: 'Salesforce', label: 'Complaint case, routed to the complaints queue' });
    planned.push({ system: 'Archive', label: 'Transcript (text only, no audio)' });
    return { planned, approvals };
  }

  async function createIntent(ctx: UserContext, draft: DebriefDraft): Promise<WriteIntent> {
    if (!draft.accountId) throw new AppError('VALIDATION', 'Pick the client meeting before saving.');
    assertInBook(ctx, draft.accountId);
    const { planned, approvals } = plannedFor(draft);
    return d.gateway.createIntent(ctx, 'debrief.save', { draftId: draft.id, draft }, {
      summary: `Save the ${draft.accountName} debrief to Salesforce`,
      planned,
      approvals,
    });
  }

  function approvalsFromDraft(draft: DebriefDraft): Record<string, boolean> {
    return {
      ...Object.fromEntries(draft.opportunities.map((o) => [`opp:${o.id}`, o.approved])),
      ...Object.fromEntries(draft.contactUpdates.map((c) => [`contact:${c.name}`, c.approved])),
    };
  }

  function savedMessage(draft: DebriefDraft, result: WriteResult): string {
    const tasks = result.written.filter((w) => w.kind === 'task').length;
    const opp = result.written.find((w) => w.kind === 'opportunity');
    const held = result.held.find((h) => h.kind === 'opportunity');
    const contact = draft.attendees.find((a) => a.external);
    const parts = [`Saved to Salesforce. ${tasks} task${tasks === 1 ? '' : 's'} created`];
    if (opp) parts.push('opportunity created');
    if (held) parts.push('opportunity held');
    if (draft.flags.complaint.flagged) parts.push('complaint routed');
    const offer = contact && flags.isActive('F03_DRAFTS') ? ` Want me to draft the recap to ${firstName(contact.name)}?` : '';
    const ref = draft.specialistInterest.length && flags.isActive('F05_REFERRALS') && !contact ? ` Want me to send ${SPECIALTY_LABEL[draft.specialistInterest[0]]} a referral?` : '';
    return `${parts.join(', ')}.${offer}${ref}`;
  }

  // ------------------------------------------------------------------ executor (debrief.save)
  async function execute(s: WriteSession, payload: unknown): Promise<ExecutorResult> {
    const { draft } = payload as { draftId: string; draft: DebriefDraft };
    const ctx = s.ctx as UserContext;
    assertInBook(ctx, draft.accountId);
    const sf = adapters.salesforce;
    const written: ExecutorResult['written'] = [];
    const held: ExecutorResult['held'] = [];
    const acct = draft.accountId;
    const meeting = draft.meetingId ? await adapters.calendar.getMeeting(ctx, draft.meetingId) : null;
    // Live-listening text is persisted only now, after the RM confirmed (F11-FR3).
    for (const src of transcriptSources) {
      for (const l of src(draft.sessionId) ?? []) await appendTranscript(draft.sessionId, l.speaker, l.text);
    }
    const lines = await transcript(draft.sessionId);

    // Transcript only, never audio (rule 5, C-10, C-11).
    const { ref } = await s.write({ system: 'SHERPA', object: 'TranscriptArchive', action: 'archive.store', accountId: acct }, () =>
      adapters.archive.storeTranscript(ctx, { sessionId: draft.sessionId, lines: lines.map((l) => ({ speaker: l.speaker, text: l.text, at: l.at })) }), (r) => ({ targetId: r.ref }));
    written.push({ kind: 'archive', label: 'Transcript archived (text only)', system: 'Archive', externalId: ref });

    const fields = {
      Account__c: acct,
      Event_Id__c: draft.meetingId,
      Meeting_Date__c: meeting?.start ?? draft.meetingStart,
      Meeting_Type__c: draft.meetingType,
      Purpose__c: draft.purpose,
      Summary__c: draft.summary,
      Client_Needs__c: draft.clientNeeds,
      Risk_Signals__c: draft.riskSignals,
      Risk_Flag__c: draft.flags.risk.flagged,
      Complaint_Flag__c: draft.flags.complaint.flagged,
      MNPI_Flag__c: draft.flags.mnpi.flagged,
      Specialist_Interest__c: draft.specialistInterest.join(';'),
      Source__c: s.confirmation.channel === 'voice' ? 'App' : 'App',
      Transcript_Ref__c: ref,
      Confirmed_By__c: ctx.rmId,
      Confirmed_At__c: clock.now().toISOString(),
      Model_Version__c: d.modelVersion,
    };
    const deb = await s.write({ system: 'SALESFORCE', object: 'Meeting_Debrief__c', action: 'create', accountId: acct }, () => sf.createDebrief(ctx, fields), (r) => ({ targetId: r.id, after: fields }));
    written.push({ kind: 'debrief', label: 'Meeting debrief', system: 'Salesforce', externalId: deb.id });

    if (draft.attendees.length) {
      await s.write({ system: 'SALESFORCE', object: 'Debrief_Attendee__c', action: 'create', accountId: acct }, () => sf.createAttendees(ctx, deb.id, draft.attendees), (r) => ({ targetId: r.ids.join(','), after: { count: r.ids.length } }));
    }

    // Tasks: included steps only (F01-AC5).
    const steps = draft.nextSteps.filter((x) => x.include);
    if (steps.length) {
      const taskInputs = steps.map((x) => ({
        accountId: acct, bookRmId: draft.rmId, ownerId: x.ownerType === 'TEAM' ? undefined : x.ownerId, ownerName: x.ownerName || ctx.user.name,
        subject: x.title, dueDate: x.dueDate, clientCommitment: x.clientCommitment, debriefId: deb.id,
      }));
      const r = await s.write({ system: 'SALESFORCE', object: 'Task', action: 'create', accountId: acct }, () => sf.createTasks(ctx, taskInputs), (res) => ({ targetId: res.ids.join(','), after: taskInputs }));
      steps.forEach((x, i) => written.push({ kind: 'task', label: `Task: ${x.title}${x.dueDate ? ` · due ${formatShortDate(x.dueDate)}` : ''}`, system: 'Salesforce', externalId: r.ids[i] }));
    }
    for (const x of draft.nextSteps.filter((n) => !n.include)) held.push({ kind: 'task', label: `Task: ${x.title}`, reason: 'Excluded' });

    // Opportunities: only with the explicit approval item (C-02).
    for (const o of draft.opportunities) {
      if (!s.approved(`opp:${o.id}`)) {
        held.push({ kind: 'opportunity', label: `Opportunity: ${o.product}${o.amount ? ` ${formatMoney(o.amount)}` : ''}`, reason: 'Held · not approved' });
        continue;
      }
      if (o.isNew || !o.existingOpportunityId) {
        const opp = { accountId: acct, name: `${draft.accountName} – ${o.product}`, amount: o.amount, closeDate: o.closeQuarter ? quarterEndDate(o.closeQuarter) : null, stage: 'Prospecting', leadSource: 'Sherpa', product: o.product };
        const r = await s.write({ system: 'SALESFORCE', object: 'Opportunity', action: 'create', accountId: acct }, () => sf.createOpportunity(ctx, opp), (res) => ({ targetId: res.id, after: opp }));
        written.push({ kind: 'opportunity', label: `Opportunity: ${o.product}${o.amount ? ` ${formatMoney(o.amount)}` : ''}`, system: 'Salesforce', externalId: r.id });
      } else {
        const changes = { ...(o.changes?.amount ? { amount: o.changes.amount } : {}), ...(o.changes?.stage ? { stage: o.changes.stage } : {}), ...(o.changes?.closeDate ? { closeDate: o.changes.closeDate } : {}) };
        const r = await s.write({ system: 'SALESFORCE', object: 'Opportunity', action: 'update', accountId: acct }, () => sf.updateOpportunity(ctx, o.existingOpportunityId!, changes), (res) => ({ targetId: o.existingOpportunityId, after: res.after }));
        written.push({ kind: 'opportunity', label: `Opportunity updated: ${r.after.name}`, system: 'Salesforce', externalId: o.existingOpportunityId });
      }
    }

    for (const c of draft.contactUpdates) {
      if (!s.approved(`contact:${c.name}`)) {
        held.push({ kind: 'contact', label: `Contact: ${c.name}`, reason: 'Held · not approved' });
        continue;
      }
      const r = await s.write({ system: 'SALESFORCE', object: 'Contact', action: 'upsert', accountId: acct }, () => sf.upsertContact(ctx, { id: c.contactId, accountId: acct, name: c.name, title: c.title, email: c.email }), (res) => ({ targetId: res.id, after: { title: c.title } }));
      written.push({ kind: 'contact', label: `Contact ${r.created ? 'added' : 'updated'}: ${c.name}`, system: 'Salesforce', externalId: r.id });
    }

    if (draft.meetingId) {
      const desc = `Sherpa debrief: ${draft.summary.split(/(?<=\.)\s/)[0] ?? ''}`;
      await s.write({ system: 'SALESFORCE', object: 'Event', action: 'update', accountId: acct }, () => sf.updateEvent(ctx, draft.meetingId!, { appendDescription: desc, debriefId: deb.id }), () => ({ targetId: draft.meetingId!, after: { debriefId: deb.id } }));
      written.push({ kind: 'event', label: 'Meeting event updated', system: 'Salesforce', externalId: draft.meetingId });
    }

    // Complaints route on save regardless of approvals (C-03).
    let caseId: string | null = null;
    if (draft.flags.complaint.flagged) {
      const complainant = draft.attendees.find((a) => a.external && a.contactId && (draft.flags.complaint.evidence ?? '').includes(firstName(a.name)));
      const c = await s.write({ system: 'SALESFORCE', object: 'Case', action: 'create.complaint', accountId: acct }, () =>
        sf.createComplaintCase(ctx, { accountId: acct, contactId: complainant?.contactId, subject: `Complaint: ${draft.flags.complaint.summary?.replace(/^Client raised /, '').replace(/\.$/, '') ?? 'client dissatisfaction'}`, description: draft.flags.complaint.evidence ?? '' }), (r) => ({ targetId: r.id, after: { queue: r.queue } }));
      caseId = c.id;
      written.push({ kind: 'complaint', label: `Complaint case routed to ${c.queue}`, system: 'Salesforce', externalId: c.id });
      await adapters.events.publish(ctx, 'complaint.routed', { caseId: c.id, accountId: acct });
    }

    await s.write({ system: 'SALESFORCE', object: 'Activity', action: 'log', accountId: acct }, () => sf.logActivity(ctx, { accountId: acct, type: 'DEBRIEF', subject: `Debrief: ${PURPOSE_LABEL[draft.purpose]}` }));

    // Sherpa DB bookkeeping
    const debriefId = randomUUID();
    const confirmed = { ...draft, status: 'CONFIRMED' as const, flowState: 'SAVED' as const, updatedAt: clock.now().toISOString() };
    const contact = draft.attendees.find((a) => a.external && a.contactId);
    await db.debrief.create({
      data: {
        id: debriefId, draftId: draft.id, userId: ctx.rmId, accountId: acct, salesforceId: deb.id, transcriptRef: ref, confirmedAt: clock.now(), modelVersion: d.modelVersion, channel: s.confirmation.channel,
        resultJson: JSON.stringify({ draft: confirmed, written, held, themes: `${draft.summary} ${draft.clientNeeds}`, firstClientContact: contact ? { id: contact.contactId, name: contact.name } : null, confirmedBy: ctx.user.name }),
      },
    });
    await db.debriefDraft.update({ where: { id: draft.id }, data: { status: 'CONFIRMED', draftJson: JSON.stringify(confirmed) } });
    await db.voiceSession.updateMany({ where: { id: draft.sessionId }, data: { endedAt: clock.now(), state: 'SAVED' } });

    if (draft.flags.complaint.flagged) await compliance.createItem({ type: 'COMPLAINT', accountId: acct, rmId: ctx.rmId, excerpt: draft.flags.complaint.evidence ?? '', debriefId, caseId });
    if (draft.flags.mnpi.flagged) await compliance.createItem({ type: 'MNPI', accountId: acct, rmId: ctx.rmId, excerpt: draft.flags.mnpi.evidence ?? '', debriefId, caseId: null });
    if (draft.flags.sensitive.flagged && draft.flags.sensitive.kept) await compliance.createItem({ type: 'SENSITIVE', accountId: acct, rmId: ctx.rmId, excerpt: `Kept: ${(draft.flags.sensitive.categories ?? []).join(', ')}`, debriefId, caseId: null });
    await brief.invalidate(acct);
    return { written, held, debriefId };
  }
  d.gateway.register('debrief.save', execute);

  // ------------------------------------------------------------------ public API
  async function turnResultToAgentTurn(ctx: UserContext, draft: DebriefDraft, r: DebriefTurnResult, rmText: string): Promise<AgentTurn> {
    const messages: AgentMessage[] = [await appendTranscript(draft.sessionId, 'RM', rmText)];
    const actions: UiAction[] = [];
    let current = r.draft;
    let intent: WriteIntent | undefined;
    let writeResult: WriteResult | undefined;
    for (const rep of r.replies) messages.push(await appendTranscript(draft.sessionId, 'AGENT', rep.text, rep.kind));

    if (r.action?.type === 'REMATCH') {
      const rematched = await rematch(ctx, current, r.action.query);
      current = rematched.draft;
      messages.push(await appendTranscript(draft.sessionId, 'AGENT', rematched.reply, 'QUESTION'));
    } else if (r.action?.type === 'SAVE') {
      current.status = 'REVIEW';
      await saveDraft(current);
      intent = await createIntent(ctx, current);
      try {
        writeResult = await d.gateway.execute(ctx, { intentId: intent.id, confirmedBy: ctx.rmId, channel: 'voice', approvals: approvalsFromDraft(current), utterance: r.action.utterance });
      } catch (err) {
        const msg = err instanceof AppError && err.code === 'UPSTREAM_UNAVAILABLE' ? "Salesforce isn't responding. Your draft is saved." : "I couldn't save that just now. Your draft is saved.";
        messages.push(await appendTranscript(draft.sessionId, 'AGENT', msg, 'TEXT'));
        return { messages, actions, draft: current, flags: r.flags, flowState: current.flowState };
      }
      current = { ...current, status: 'CONFIRMED', flowState: 'SAVED' };
      messages.push(await appendTranscript(draft.sessionId, 'AGENT', savedMessage(current, writeResult), 'RESULT'));
      actions.push({ type: 'OPEN_SAVED', debriefId: writeResult.debriefId! });
    } else if (r.action?.type === 'OPEN_DRAFTS' || r.action?.type === 'OPEN_REFERRAL') {
      const deb = await db.debrief.findFirst({ where: { draftId: current.id } });
      if (deb) {
        actions.push(r.action.type === 'OPEN_DRAFTS'
          ? { type: 'NAVIGATE', route: `/drafts/${deb.id}` }
          : { type: 'NAVIGATE', route: `/referral/new?debriefId=${deb.id}&accountId=${current.accountId}${r.action.specialty ? `&specialty=${r.action.specialty}` : ''}` });
      }
    }
    if (current.status !== 'CONFIRMED') await saveDraft(current);
    if (current.flowState === 'APPROVE_OPPORTUNITY' || current.flowState === 'CONFIRM') actions.push({ type: 'OPEN_REVIEW', draftId: current.id });
    return { messages, actions, intent, writeResult, draft: current, flags: r.flags, flowState: current.flowState };
  }

  /** "No, it was Harbor" / "my 4 PM" → re-propose a meeting within the RM's book (F01-FR1). */
  async function rematch(ctx: UserContext, draft: DebriefDraft, query: string): Promise<{ draft: DebriefDraft; reply: string }> {
    const q = query.toLowerCase().replace(/^(no|nope|not that one|wrong one)[,.\s]*/i, '').replace(/^(it was|it's|the)\s+/i, '');
    const accounts = await adapters.salesforce.listAccounts(ctx, { ownerRmIds: ctx.bookRmIds });
    const match = accounts.filter((a) => q.length >= 3 && (a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase().split(' ')[0])));
    if (match.length > 1) {
      const ambiguous = match.map((a) => `${a.name} in ${a.city}`).join(' or ');
      return { draft, reply: `Did you mean ${ambiguous}?` };
    }
    const account = match[0];
    if (!account) return { draft, reply: "I couldn't find that client in your book. Which client was it?" };
    const today = clock.today();
    const meetings = await adapters.calendar.listMeetings(ctx, { from: new Date(today.getTime() - 86_400_000), to: clock.now(), ownerRmIds: ctx.bookRmIds });
    const m = meetings.filter((x) => x.accountId === account.id).pop() ?? null;
    const updated: DebriefDraft = {
      ...draft,
      accountId: account.id,
      accountName: account.name,
      meetingId: m?.id ?? null,
      meetingStart: m?.start ?? null,
      meetingType: m?.type ?? 'PHONE',
      attendees: await attendeesFor(ctx, m, account.id),
    };
    const reply = openingLine({ accountName: account.name, startLabel: m ? formatTime(m.start) : 'meeting', attendees: m ? m.attendees.filter((x) => x.external).map((x) => x.name) : [] });
    return { draft: updated, reply };
  }

  return {
    recentMeetings,
    execute,
    addTranscriptSource: (src: TranscriptSource) => transcriptSources.push(src),

    async start(ctx: UserContext, req: StartDebriefRequest): Promise<StartDebriefResponse> {
      flags.require('F01_DEBRIEF');
      if (!ctx.bookRmIds.length) throw forbidden('Your role does not have a client book.');

      if (req.resumeDraftId) {
        const draft = await loadDraft(ctx, req.resumeDraftId);
        if (draft.status === 'CONFIRMED') throw conflict('That debrief was already saved.');
        // Live-listening text is persisted only now, after the RM confirmed (F11-FR3).
    for (const src of transcriptSources) {
      for (const l of src(draft.sessionId) ?? []) await appendTranscript(draft.sessionId, l.speaker, l.text);
    }
    const lines = await transcript(draft.sessionId);
        const lastAgent = [...lines].reverse().find((l) => l.speaker === 'AGENT' && !l.text.startsWith('Picking up'));
        const opening = `Picking up your ${draft.accountName} debrief. ${lastAgent?.text ?? ''}`.trim();
        await appendTranscript(draft.sessionId, 'AGENT', opening, 'TEXT');
        return { sessionId: draft.sessionId, draftId: draft.id, proposedMeeting: null, resumeOf: null, opening, draft };
      }

      // F01-FR10: an unfinished draft is offered for resume first.
      const resumable = await db.debriefDraft.findMany({ where: { userId: ctx.rmId, status: { in: ['CAPTURING', 'REVIEW'] } }, orderBy: { updatedAt: 'desc' } });
      if (req.startOver) {
        await db.debriefDraft.updateMany({ where: { userId: ctx.rmId, status: { in: ['CAPTURING', 'REVIEW'] }, ...(req.meetingId ? { meetingId: req.meetingId } : {}) }, data: { status: 'ABANDONED' } });
      } else {
        const candidate = resumable.find((r) => (req.meetingId ? r.meetingId === req.meetingId : true));
        if (candidate) {
          const draft = JSON.parse(candidate.draftJson) as DebriefDraft;
          const hasContent = draft.summary || draft.nextSteps.length || draft.flowState !== 'MATCH_MEETING';
          if (hasContent) {
            return {
              sessionId: draft.sessionId, draftId: draft.id, proposedMeeting: null,
              resumeOf: { draftId: draft.id, accountName: draft.accountName, updatedAt: candidate.updatedAt.toISOString() },
              opening: openingLine(null, { accountName: draft.accountName }), draft,
            };
          }
        }
      }

      let meeting: Awaited<ReturnType<typeof adapters.calendar.getMeeting>> = null;
      if (req.meetingId) {
        meeting = await adapters.calendar.getMeeting(ctx, req.meetingId);
        if (!meeting || !meeting.accountId) throw notFound('That meeting');
        assertInBook(ctx, meeting.accountId);
      } else if (req.accountId) {
        assertInBook(ctx, req.accountId);
        const recent = (await recentMeetings(ctx)).find((m) => m.accountId === req.accountId);
        meeting = recent ? await adapters.calendar.getMeeting(ctx, recent.id) : null;
      } else {
        const recent = (await recentMeetings(ctx))[0];
        meeting = recent ? await adapters.calendar.getMeeting(ctx, recent.id) : null;
      }
      const accountId = meeting?.accountId ?? req.accountId ?? '';
      const account = accountId ? await adapters.salesforce.getAccount(ctx, accountId) : null;
      const sessionId = randomUUID();
      await db.voiceSession.create({ data: { id: sessionId, userId: ctx.rmId, mode: 'DEBRIEF', channel: req.channel, state: 'MATCH_MEETING', accountId: accountId || null, meetingId: meeting?.id ?? null, startedAt: clock.now() } });
      const draft = newDebriefDraft({
        sessionId, rmId: account?.ownerRmId ?? ctx.rmId, accountId, accountName: account?.name ?? '', meetingId: meeting?.id ?? null,
        meetingStart: meeting?.start ?? null, meetingType: meeting?.type ?? 'IN_PERSON', meetingSubject: meeting?.subject ?? null,
        attendees: await attendeesFor(ctx, meeting, accountId), now: clock.now(), matched: Boolean(meeting),
      });
      await db.debriefDraft.create({ data: { id: draft.id, voiceSessionId: sessionId, userId: ctx.rmId, accountId, meetingId: draft.meetingId, status: draft.status, draftJson: JSON.stringify(draft) } });
      const proposedMeeting = meeting && account
        ? { meetingId: meeting.id, accountId: account.id, accountName: account.name, city: account.city, subject: meeting.subject, start: meeting.start, end: meeting.end, attendees: meeting.attendees.filter((a) => a.external).map((a) => a.name) }
        : null;
      const opening = !account && accountId === '' && req.accountId === undefined && !meeting
        ? openingLine(null)
        : openingLine(proposedMeeting ? { accountName: proposedMeeting.accountName, startLabel: formatTime(proposedMeeting.start), attendees: proposedMeeting.attendees } : { accountName: account?.name ?? '', startLabel: 'meeting', attendees: [] });
      await appendTranscript(sessionId, 'AGENT', opening, 'QUESTION');
      return { sessionId, draftId: draft.id, proposedMeeting, resumeOf: null, opening, draft };
    },

    async getDraft(ctx: UserContext, draftId: string) {
      return loadDraft(ctx, draftId);
    },

    async transcriptFor(ctx: UserContext, draftId: string) {
      const draft = await loadDraft(ctx, draftId);
      return transcript(draft.sessionId);
    },

    async chat(ctx: UserContext, draftId: string, text: string, onEarlyReply?: (text: string) => void): Promise<AgentTurn> {
      flags.require('F01_DEBRIEF');
      const draft = await loadDraft(ctx, draftId);
      if (draft.status === 'CONFIRMED' && draft.flowState !== 'SAVED') throw conflict('That debrief was already saved.');
      if (draft.accountId) assertInBook(ctx, draft.accountId);
      const dctx = await buildContext(ctx, draft);
      const r = await debriefTurn({
        draft, text, ctx: dctx, model, now: clock.now(),
        onEarlyReply: onEarlyReply
          ? (rep) => {
              onEarlyReply(rep.text);
              void appendTranscript(draft.sessionId, 'AGENT', rep.text, rep.kind);
            }
          : undefined,
      });
      return turnResultToAgentTurn(ctx, draft, r, text);
    },

    async patch(ctx: UserContext, draftId: string, patch: DebriefDraftPatch): Promise<DebriefDraft> {
      const draft = await loadDraft(ctx, draftId);
      if (draft.status === 'CONFIRMED') throw conflict('That debrief was already saved.');
      // Complaints cannot be suppressed (rule 3, F01-AC4).
      if (patch.flags?.complaint?.flagged === false && draft.flags.complaint.flagged) {
        throw conflict('A complaint flag cannot be removed. It is logged and routed per policy.', { code: 'COMPLAINT_LOCKED' });
      }
      if (patch.flags?.complaint?.flagged === false) throw conflict('The complaint flag cannot be changed here.', { code: 'COMPLAINT_LOCKED' });
      if (patch.summary !== undefined) draft.summary = patch.summary;
      if (patch.clientNeeds !== undefined) draft.clientNeeds = patch.clientNeeds;
      if (patch.riskSignals !== undefined) draft.riskSignals = patch.riskSignals;
      if (patch.purpose) {
        draft.purpose = patch.purpose;
        draft.missingFields = draft.missingFields.filter((m) => m !== 'purpose');
      }
      for (const p of patch.nextSteps ?? []) {
        const step = draft.nextSteps.find((s) => s.id === p.id);
        if (!step) continue;
        if (p.include !== undefined) step.include = p.include;
        if (p.title !== undefined) step.title = p.title;
        if (p.dueDate !== undefined) step.dueDate = p.dueDate;
        if (p.ownerName !== undefined) {
          const users = await adapters.salesforce.listUsers(ctx);
          const u = users.find((x) => x.name.toLowerCase() === p.ownerName!.toLowerCase());
          step.ownerName = u?.name ?? p.ownerName;
          step.ownerId = u?.id;
          step.ownerType = u ? (u.id === draft.rmId ? 'RM' : 'USER') : 'TEAM';
        }
        step.suggested = false;
      }
      for (const p of patch.opportunities ?? []) {
        const o = draft.opportunities.find((x) => x.id === p.id);
        if (!o) continue;
        if (p.amount !== undefined) o.amount = p.amount;
        if (p.closeQuarter !== undefined) o.closeQuarter = p.closeQuarter;
        if (p.approved !== undefined) o.approved = p.approved;
      }
      if (patch.specialistInterest) draft.specialistInterest = patch.specialistInterest;
      for (const p of patch.contactUpdates ?? []) {
        const c = draft.contactUpdates.find((x) => x.name === p.name);
        if (c) c.approved = p.approved;
      }
      if (patch.flags?.sensitive?.kept !== undefined && draft.flags.sensitive.flagged) draft.flags.sensitive.kept = patch.flags.sensitive.kept;
      draft.updatedAt = clock.now().toISOString();
      await saveDraft(draft);
      return draft;
    },

    async intent(ctx: UserContext, draftId: string): Promise<WriteIntent> {
      const draft = await loadDraft(ctx, draftId);
      if (draft.status === 'CONFIRMED') throw conflict('That debrief was already saved.');
      return createIntent(ctx, draft);
    },

    async confirm(ctx: UserContext, c: Confirmation): Promise<WriteResult> {
      const intent = await d.gateway.getIntent(ctx, c.intentId);
      if (intent.kind !== 'debrief.save') throw notFound('That confirmation request');
      const result = await d.gateway.execute(ctx, { ...c, confirmedBy: ctx.rmId });
      const draft = (intent.payload as { draft: DebriefDraft }).draft;
      await appendTranscript(draft.sessionId, 'AGENT', savedMessage(draft, result), 'RESULT').catch(() => undefined);
      return result;
    },

    async detail(ctx: UserContext, debriefId: string): Promise<DebriefDetail> {
      const row = await db.debrief.findUnique({ where: { id: debriefId } });
      if (!row) throw notFound('That debrief');
      assertInBook(ctx, row.accountId);
      const r = JSON.parse(row.resultJson) as { draft: DebriefDraft; written: DebriefDetail['written']; held: DebriefDetail['held']; firstClientContact: DebriefDetail['firstClientContact']; confirmedBy: string };
      return {
        id: row.id, accountId: row.accountId, accountName: r.draft.accountName, confirmedAt: row.confirmedAt.toISOString(), confirmedBy: r.confirmedBy,
        salesforceId: row.salesforceId, draft: r.draft, written: r.written, held: r.held, firstClientContact: r.firstClientContact,
      };
    },

    async resumable(ctx: UserContext): Promise<DebriefDraft[]> {
      const rows = await db.debriefDraft.findMany({ where: { userId: ctx.rmId, status: { in: ['CAPTURING', 'REVIEW'] } }, orderBy: { updatedAt: 'desc' } });
      return rows.map((r) => JSON.parse(r.draftJson) as DebriefDraft).filter((x) => x.summary || x.nextSteps.length || x.flowState !== 'MATCH_MEETING');
    },

    /** Used by the voice gateway and live listening. */
    loadDraft,
    saveDraft,
    appendTranscript,
    buildContext,
    turnResultToAgentTurn,
    approvalQuestion,
  };
}
export type DebriefService = ReturnType<typeof createDebriefService>;
