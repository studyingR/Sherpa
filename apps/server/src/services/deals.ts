/** F07 deal intake (nCino DRAFT only), F11 live listening (gated), F12 pricing guidance (gated). */
import { randomUUID } from 'node:crypto';
import { dealTurn, debriefTurn, detectComplaint, detectMnpi, findAmount, missingDealFields, newDebriefDraft, quarterEndDate, resolveQuarter } from '@sherpa/agent';
import {
  DEAL_PRODUCT_LABEL,
  formatMoney,
  type AgentMessage,
  type DebriefDraft,
  type FlagEvent,
  type DealDraft,
  type DealDraftPatch,
  type PricingGuidance,
  type WriteIntent,
  type WriteResult,
} from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { assertInBook } from '../auth/entitlements';
import type { Deps } from '../deps';
import { AppError, conflict, notFound } from '../lib/errors';
import type { WriteSession } from '../write-gateway';
import type { BookService } from './book';
import type { DebriefService } from './debrief';

export const PRICING_DISCLAIMER = 'Indicative internal guidance. Not a quote. Subject to credit approval and pricing authority.';

// ====================================================================== F07 deals
export function createDealService(d: Deps, book: BookService) {
  const { db, adapters, clock, model, flags } = d;

  async function load(ctx: UserContext, id: string): Promise<DealDraft> {
    const row = await db.dealDraft.findUnique({ where: { id } });
    if (!row || row.userId !== ctx.rmId) throw notFound('That deal draft');
    assertInBook(ctx, row.accountId);
    return JSON.parse(row.draftJson) as DealDraft;
  }
  async function save(draft: DealDraft) {
    await db.dealDraft.update({ where: { id: draft.id }, data: { draftJson: JSON.stringify(draft), status: draft.status } });
  }

  async function createIntent(ctx: UserContext, draft: DealDraft): Promise<WriteIntent> {
    // F07-AC2: amount, term and collateral must be read back and confirmed first.
    if (!draft.readBackDone) throw conflict('Read back the amount, term and collateral before creating the draft.', { code: 'READBACK_REQUIRED' });
    const missing = missingDealFields(draft);
    if (missing.length) throw new AppError('VALIDATION', `Still needed: ${missing.join(', ')}.`, { missing });
    const planned = [{ system: 'nCino', label: `Draft credit request: ${draft.product ? DEAL_PRODUCT_LABEL[draft.product] : ''} ${draft.amount ? formatMoney(draft.amount) : ''} · not submitted to credit` }];
    const approvals = draft.opportunityId ? [] : [{ id: 'opp:deal', kind: 'OPPORTUNITY_CREATE' as const, label: `Create Salesforce opportunity for ${formatMoney(draft.amount ?? 0)}` }];
    if (!draft.opportunityId) planned.push({ system: 'Salesforce', label: 'Linked opportunity (needs your OK)' } as { system: string; label: string });
    return d.gateway.createIntent(ctx, 'deal.draft', { dealId: draft.id, draft }, { summary: `Create a draft credit request in nCino for ${draft.accountName}`, planned, approvals });
  }

  d.gateway.register('deal.draft', async (s: WriteSession, payload) => {
    const { draft } = payload as { draft: DealDraft };
    const ctx = s.ctx as UserContext;
    assertInBook(ctx, draft.accountId);
    const req = {
      accountId: draft.accountId, borrower: draft.borrower, guarantors: draft.guarantors, product: draft.product, amount: draft.amount, purpose: draft.purpose,
      termMonths: draft.termMonths, amortizationMonths: draft.amortizationMonths, collateral: draft.collateral, requestedTiming: draft.requestedTiming,
      useOfProceeds: draft.useOfProceeds, knownRisks: draft.knownRisks, status: 'Draft — RM review',
    };
    const r = await s.write({ system: 'NCINO', object: 'CreditRequest', action: 'create.draft', accountId: draft.accountId }, () => adapters.ncino.createDraftRequest(ctx, req), (res) => ({ targetId: res.id, after: { status: res.status } }));
    const written = [{ kind: 'deal', label: `nCino draft ${r.id} · ${r.status} · not submitted to credit`, system: 'nCino', externalId: r.id }];
    const held = [];
    let opportunityId = draft.opportunityId;
    if (!opportunityId) {
      if (s.approved('opp:deal')) {
        const q = resolveQuarter(draft.requestedTiming, clock.today());
        const opp = { accountId: draft.accountId, name: `${draft.accountName} – ${draft.product ? DEAL_PRODUCT_LABEL[draft.product] : 'Credit'}`, amount: draft.amount, closeDate: q ? quarterEndDate(q) : null, stage: 'Prospecting', leadSource: 'Sherpa', product: draft.product ? DEAL_PRODUCT_LABEL[draft.product] : 'Credit' };
        const o = await s.write({ system: 'SALESFORCE', object: 'Opportunity', action: 'create', accountId: draft.accountId }, () => adapters.salesforce.createOpportunity(ctx, opp), (res) => ({ targetId: res.id, after: opp }));
        opportunityId = o.id;
        written.push({ kind: 'opportunity', label: `Opportunity: ${opp.name}`, system: 'Salesforce', externalId: o.id });
      } else {
        held.push({ kind: 'opportunity', label: 'Linked opportunity', reason: 'Held · not approved' });
      }
    }
    // Hand-off to the credit memo generator (external, mocked as an event).
    await adapters.events.publish(ctx, 'deal.draft_created', { ncinoDraftId: r.id, accountId: draft.accountId, opportunityId: opportunityId ?? null });
    const updated: DealDraft = { ...draft, status: 'DRAFT_CREATED', ncinoDraftId: r.id, opportunityId };
    await save(updated);
    return { written, held, resultRef: r.id };
  });

  return {
    async start(ctx: UserContext, accountId: string, fromDebriefId?: string) {
      flags.require('F07_DEAL_INTAKE');
      const a = await book.account(ctx, accountId);
      const loans = await adapters.ncino.getLoans(ctx, accountId);
      const total = loans.reduce((x, l) => x + l.commitment, 0);
      const outstanding = loans.reduce((x, l) => x + l.outstanding, 0);
      const asOf = loans[0]?.asOf ?? clock.now().toISOString();
      const draft: DealDraft = {
        id: randomUUID(), accountId, accountName: a.name, borrower: a.name, guarantors: [], product: null, amount: null, purpose: '', termMonths: null,
        amortizationMonths: null, collateral: '', requestedTiming: '', useOfProceeds: '', knownRisks: '',
        existingExposure: [
          { key: 'exposure.commitment', label: 'Total commitments', value: total, display: formatMoney(total), source: 'NCINO', asOf },
          { key: 'exposure.outstanding', label: 'Total outstanding', value: outstanding, display: formatMoney(outstanding), source: 'NCINO', asOf },
          { key: 'exposure.facilities', label: 'Facilities', value: loans.length, display: String(loans.length), source: 'NCINO', asOf },
        ],
        missingFields: [], questionsAsked: 0, pendingField: null, awaitingReadBack: false, readBackDone: false, status: 'CAPTURING',
      };
      if (fromDebriefId) {
        const deb = await db.debrief.findUnique({ where: { id: fromDebriefId } });
        const opp = deb ? (JSON.parse(deb.resultJson) as { draft: DebriefDraft }).draft.opportunities[0] : undefined;
        if (opp) {
          draft.amount = opp.amount;
          draft.product = /equipment/i.test(opp.product) ? 'EQUIPMENT' : /sba/i.test(opp.product) ? 'SBA_7A' : /line/i.test(opp.product) ? 'LINE_OF_CREDIT' : /real estate/i.test(opp.product) ? 'CRE' : /term/i.test(opp.product) ? 'TERM_LOAN' : null;
        }
      }
      draft.missingFields = missingDealFields(draft);
      const sessionId = randomUUID();
      await db.voiceSession.create({ data: { id: sessionId, userId: ctx.rmId, mode: 'DEAL', state: 'CAPTURING', accountId, startedAt: clock.now() } });
      await db.dealDraft.create({ data: { id: draft.id, userId: ctx.rmId, accountId, voiceSessionId: sessionId, draftJson: JSON.stringify(draft), status: draft.status } });
      const opening = `New deal for ${a.name}. Tell me about the request: product, amount, purpose, term and collateral.`;
      return { sessionId, dealDraftId: draft.id, draft, opening };
    },
    get: load,
    async patch(ctx: UserContext, id: string, p: DealDraftPatch): Promise<DealDraft> {
      const draft = await load(ctx, id);
      if (draft.status === 'DRAFT_CREATED') throw conflict('This deal draft is already in nCino.');
      const touchesReadBack = p.amount !== undefined || p.termMonths !== undefined || p.collateral !== undefined;
      Object.assign(draft, p);
      if (touchesReadBack && p.readBackDone === undefined) draft.readBackDone = false;
      draft.missingFields = missingDealFields(draft);
      if (draft.readBackDone && !draft.missingFields.length) draft.status = 'READY';
      await save(draft);
      return draft;
    },
    async turn(ctx: UserContext, id: string, text: string): Promise<{ messages: AgentMessage[]; draft: DealDraft; intent?: WriteIntent; writeResult?: WriteResult }> {
      const draft = await load(ctx, id);
      const r = await dealTurn({ draft, text, model });
      const at = clock.now().toISOString();
      const messages: AgentMessage[] = [{ id: randomUUID(), speaker: 'RM', text, kind: 'TEXT', at }, ...r.replies.map((x) => ({ id: randomUUID(), speaker: 'AGENT' as const, text: x.text, kind: x.kind, at }))];
      await save(r.draft);
      if (r.action?.type === 'CREATE_DRAFT') {
        const intent = await createIntent(ctx, r.draft);
        const writeResult = await d.gateway.execute(ctx, { intentId: intent.id, confirmedBy: ctx.rmId, channel: 'voice', approvals: {}, utterance: r.action.utterance });
        messages.push({ id: randomUUID(), speaker: 'AGENT', text: `Created the draft in nCino for your review. It has not been submitted to credit.${writeResult.held.length ? ' The opportunity is held until you approve it on screen.' : ''}`, kind: 'RESULT', at });
        return { messages, draft: await load(ctx, id), intent, writeResult };
      }
      return { messages, draft: r.draft };
    },
    async intent(ctx: UserContext, id: string) {
      return createIntent(ctx, await load(ctx, id));
    },
    parseAmount: findAmount,
  };
}
export type DealService = ReturnType<typeof createDealService>;

// ====================================================================== F11 live listening (gated)
export function createLiveService(d: Deps, debriefs: DebriefService) {
  const { db, adapters, clock, model, flags, config } = d;
  /** Live transcript stays in memory until the RM confirms the resulting debrief (F11-FR3). */
  const buffers = new Map<string, { text: string; at: string }[]>();
  const states = (): string[] => {
    const f = d.flags.config.F11_LIVE_LISTENING;
    return f?.allPartyConsentStates ?? [];
  };
  void config;
  debriefs.addTranscriptSource((sessionId) => {
    const buf = buffers.get(sessionId);
    if (!buf) return null;
    buffers.delete(sessionId);
    return buf.map((b) => ({ speaker: 'RM' as const, text: b.text, at: b.at }));
  });

  return {
    buffers,
    async start(ctx: UserContext, req: { meetingId: string; jurisdiction: string; allPartyConsentConfirmed: boolean; consentStatement: string }) {
      flags.require('F11_LIVE_LISTENING');
      const meeting = await adapters.calendar.getMeeting(ctx, req.meetingId);
      if (!meeting?.accountId) throw notFound('That meeting');
      assertInBook(ctx, meeting.accountId);
      const allParty = states().includes(req.jurisdiction.toUpperCase());
      // F11-FR6 / F11-AC2: no consent, no start.
      if (allParty && !req.allPartyConsentConfirmed) throw new AppError('CONSENT_REQUIRED', 'This state requires consent from everyone in the meeting before listening can start.');
      if (!req.consentStatement.trim()) throw new AppError('CONSENT_REQUIRED', 'Record the consent statement before starting.');
      await db.consentRecord.create({ data: { id: randomUUID(), userId: ctx.rmId, meetingId: req.meetingId, jurisdiction: req.jurisdiction.toUpperCase(), allPartyRequired: allParty, statement: req.consentStatement, confirmedAt: clock.now() } });
      await d.audit.record({ userId: ctx.rmId, action: 'live.start', system: 'SHERPA', object: 'LiveSession', targetId: req.meetingId, accountId: meeting.accountId, after: { jurisdiction: req.jurisdiction, allPartyRequired: allParty }, requestId: ctx.requestId, at: clock.now() });
      const account = await adapters.salesforce.getAccount(ctx, meeting.accountId);
      const sessionId = randomUUID();
      await db.voiceSession.create({ data: { id: sessionId, userId: ctx.rmId, mode: 'LIVE', state: 'LISTENING', accountId: meeting.accountId, meetingId: meeting.id, startedAt: clock.now() } });
      const contacts = await adapters.salesforce.getContacts(ctx, meeting.accountId);
      const draft = newDebriefDraft({
        sessionId, rmId: ctx.rmId, accountId: meeting.accountId, accountName: account?.name ?? '', meetingId: meeting.id, meetingStart: meeting.start, meetingType: meeting.type,
        meetingSubject: meeting.subject, attendees: meeting.attendees.map((a) => ({ name: a.name, contactId: a.contactId, userId: a.userId, external: a.external, role: contacts.find((c) => c.id === a.contactId)?.title })), now: clock.now(), matched: true,
      });
      draft.flowState = 'OPEN_FLOOR';
      await db.debriefDraft.create({ data: { id: draft.id, voiceSessionId: sessionId, userId: ctx.rmId, accountId: draft.accountId, meetingId: draft.meetingId, status: 'CAPTURING', draftJson: JSON.stringify(draft) } });
      buffers.set(sessionId, []);
      return { sessionId, draftId: draft.id };
    },
    /** Each ~10 s segment: capture items for the RM-only side panel. No spoken output during the meeting. */
    async segment(ctx: UserContext, sessionId: string, text: string): Promise<{ captured: { nextSteps: string[]; flags: FlagEvent[] } }> {
      flags.require('F11_LIVE_LISTENING');
      const vs = await db.voiceSession.findUnique({ where: { id: sessionId } });
      if (!vs || vs.userId !== ctx.rmId || vs.mode !== 'LIVE') throw notFound('That live session');
      const buf = buffers.get(sessionId) ?? [];
      buf.push({ text, at: clock.now().toISOString() });
      buffers.set(sessionId, buf);
      const all = buf.map((b) => b.text).join(' ');
      const row = await db.debriefDraft.findFirst({ where: { voiceSessionId: sessionId } });
      const draft = JSON.parse(row!.draftJson) as DebriefDraft;
      const dctx = await debriefs.buildContext(ctx, draft);
      const ex = await model.extractDebrief(all, dctx);
      const flagsOut: FlagEvent[] = [];
      if (detectComplaint(all).flagged) flagsOut.push({ flag: 'COMPLAINT', message: 'Complaint detected — will be logged' });
      if (detectMnpi(all).flagged) flagsOut.push({ flag: 'MNPI', message: 'Possible inside information' });
      return { captured: { nextSteps: ex.nextSteps.map((s) => s.title), flags: flagsOut } };
    },
    /** Stop → full extraction over the whole transcript → F01 review (F11-FR5). */
    async stop(ctx: UserContext, sessionId: string): Promise<{ draftId: string }> {
      flags.require('F11_LIVE_LISTENING');
      const vs = await db.voiceSession.findUnique({ where: { id: sessionId } });
      if (!vs || vs.userId !== ctx.rmId || vs.mode !== 'LIVE') throw notFound('That live session');
      const row = await db.debriefDraft.findFirst({ where: { voiceSessionId: sessionId } });
      let draft = JSON.parse(row!.draftJson) as DebriefDraft;
      const text = (buffers.get(sessionId) ?? []).map((b) => b.text).join(' ');
      const dctx = await debriefs.buildContext(ctx, draft);
      if (text.trim()) {
        const r = await debriefTurn({ draft, text, ctx: dctx, model, now: clock.now() });
        draft = r.draft;
      }
      draft.status = 'REVIEW';
      draft.flowState = 'CONFIRM';
      await debriefs.saveDraft(draft);
      await db.voiceSession.update({ where: { id: sessionId }, data: { state: 'STOPPED', endedAt: clock.now() } });
      return { draftId: draft.id };
    },
  };
}
export type LiveService = ReturnType<typeof createLiveService>;

// ====================================================================== F12 pricing (gated)
export function createPricingService(d: Deps, deals: DealService) {
  const { db, adapters, clock, flags } = d;
  return {
    /** Screen-only, never in client drafts; every view is audited (C-16). */
    async guidance(ctx: UserContext, dealId: string): Promise<PricingGuidance> {
      flags.require('F12_PRICING_GUIDANCE');
      const deal = await deals.get(ctx, dealId);
      if (!deal.amount || !deal.product) throw new AppError('VALIDATION', 'Add the product and amount to the deal first.');
      const rating = await adapters.ncino.getRiskRating(ctx, deal.accountId);
      const params = { dealId, accountId: deal.accountId, product: deal.product, amount: deal.amount, termMonths: deal.termMonths, riskRating: rating?.rating ?? 5 };
      const g = await adapters.precisionLender.getPricingGuidance(ctx, params);
      const out: PricingGuidance = {
        dealId, spreadBpsRange: g.spreadBpsRange, feeRange: g.feeRange, targetRaroc: g.targetRaroc, drivers: g.drivers,
        requiresApproval: g.spreadBpsRange[0] < 175 || g.spreadBpsRange[1] > g.rmAuthorityMaxBps || deal.amount > 10_000_000,
        disclaimer: PRICING_DISCLAIMER,
      };
      await db.pricingView.create({ data: { id: randomUUID(), userId: ctx.rmId, dealId, inputsJson: JSON.stringify(params), outputJson: JSON.stringify(out), at: clock.now() } });
      await d.audit.record({ userId: ctx.rmId, action: 'pricing.view', system: 'PRECISION_LENDER', object: 'PricingGuidance', targetId: dealId, accountId: deal.accountId, before: params, after: out, requestId: ctx.requestId, at: clock.now() });
      return out;
    },
  };
}
export type PricingService = ReturnType<typeof createPricingService>;
