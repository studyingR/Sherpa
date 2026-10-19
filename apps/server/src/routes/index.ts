/** REST API (docs/04). Every route validates input with shared zod schemas and runs as the signed-in user. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashPin, setMockFailure } from '@sherpa/adapters';
import {
  AlertActionRequest,
  AskBriefRequest,
  AskRequest,
  ChatRequest,
  Confirmation,
  CoverageActionRequest,
  CreateDraftsRequest,
  DealDraftPatch,
  DebriefDraftPatch,
  DocumentRequestDraftRequest,
  LiveStartRequest,
  PatchDraftRequest,
  Preferences,
  ReferralIntentRequest,
  SignInRequest,
  Specialty,
  StartDebriefRequest,
  TaskActionRequest,
  type FlagName,
} from '@sherpa/shared';
import type { Deps } from '../deps';
import { createSupabaseVerifier } from '../auth/supabase';
import type { Services } from '../services';
import { readPrefs } from '../services/compliance';
import { AppError, forbidden } from '../lib/errors';
import { metrics, parse } from '../lib/http';

const SESSION_HOURS = 12;

export async function registerRoutes(app: FastifyInstance, d: Deps, s: Services) {
  const auth = { preHandler: [app.authenticate] };
  const flag = (f: FlagName) => ({
    preHandler: [
      async () => {
        d.flags.require(f);
      },
      app.authenticate,
    ],
  });
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  app.get('/v1/health', async () => ({ ok: true, llm: d.config.LLM_MODE, voice: d.config.VOICE_MODE, integrations: d.config.INTEGRATIONS_MODE }));

  // ------------------------------------------------------------------ 1. auth + profile
  const personasAllowed = d.config.AUTH_MODE !== 'supabase' && d.config.NODE_ENV !== 'production';
  const verifySupabase = createSupabaseVerifier(d.config);

  const profileSwitchOn = d.config.PROFILE_SWITCH ? d.config.PROFILE_SWITCH === 'on' : d.config.NODE_ENV !== 'production';

  async function issueSession(userId: string, identityEmail?: string) {
    const user = await d.adapters.identity.getUser(userId);
    if (!user) throw new AppError('UNAUTHENTICATED', "That Sherpa account doesn't exist.");
    const sid = randomUUID();
    await d.db.session.create({ data: { id: sid, userId: user.id, identityEmail: identityEmail ?? null, channel: 'APP', createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) } });
    const token = app.jwt.sign({ sub: user.id, sid }, { expiresIn: `${SESSION_HOURS}h` });
    return { token, user };
  }

  /** Tells the app which sign-in options to show. */
  app.get('/v1/auth/config', async () => ({ personas: personasAllowed, google: Boolean(verifySupabase && d.config.AUTH_MODE !== 'personas') }));

  app.get('/v1/auth/personas', async () => {
    if (!personasAllowed) throw forbidden('Test profiles are for development only.');
    return d.adapters.identity.listPersonas();
  });
  app.post('/v1/auth/sign-in', async (req) => {
    if (!personasAllowed) throw forbidden('Test profiles are for development only.');
    const { personaId } = parse(SignInRequest, req.body);
    try {
      await d.adapters.identity.signIn(personaId);
    } catch {
      throw new AppError('UNAUTHENTICATED', "We couldn't sign you in with that profile.");
    }
    return issueSession(personaId);
  });

  /** Google via Supabase Auth: verify the Supabase token, then the allowlist decides which Sherpa user this is. */
  app.post('/v1/auth/supabase', async (req) => {
    if (!verifySupabase || d.config.AUTH_MODE === 'personas') throw new AppError('NOT_FOUND', 'Not found.');
    const { accessToken } = parse(z.object({ accessToken: z.string().min(20) }), req.body);
    const identity = await verifySupabase(accessToken);
    const allowed = await d.db.authIdentity.findUnique({ where: { email: identity.email } });
    if (!allowed) {
      await d.audit.record({ userId: 'anonymous', action: 'auth.denied', system: 'SHERPA', object: 'Session', targetId: identity.email, requestId: req.id, at: d.clock.now() });
      throw new AppError('FORBIDDEN', "Your Google account isn't set up for Sherpa yet. Ask your administrator to add it.");
    }
    await d.db.authIdentity.update({ where: { email: identity.email }, data: { lastLoginAt: new Date() } });
    await d.audit.record({ userId: allowed.userId, action: 'auth.signin.google', system: 'SHERPA', object: 'Session', requestId: req.id, at: d.clock.now() });
    return issueSession(allowed.userId, identity.email);
  });
  /** The Google account behind the current session and the profiles it may use (its own plus admin-granted ones). */
  async function switchScope(req: FastifyRequest) {
    const sid = app.jwt.decode<{ sid: string }>(req.headers.authorization!.slice(7))?.sid;
    const session = sid ? await d.db.session.findUnique({ where: { id: sid } }) : null;
    const identity = session?.identityEmail ? await d.db.authIdentity.findUnique({ where: { email: session.identityEmail } }) : null;
    if (!profileSwitchOn || !session || !identity) return null;
    const granted = identity.switchableUserIds.split(',').map((x) => x.trim()).filter(Boolean);
    const personas = await d.adapters.identity.listPersonas();
    const profiles = personas.filter((p) => p.id === identity.userId || granted.includes('*') || granted.includes(p.id));
    return { session, identity, profiles };
  }

  /** Profiles this Google account can switch between; empty when switching isn't granted. */
  app.get('/v1/auth/profiles', auth, async (req) => {
    const scope = await switchScope(req);
    return scope && scope.profiles.length > 1 ? scope.profiles : [];
  });

  /** Switch to another granted profile: ends this session and starts one as that user, under the same Google account. */
  app.post('/v1/auth/switch', auth, async (req) => {
    const { userId } = parse(z.object({ userId: z.string().min(1) }), req.body);
    const scope = await switchScope(req);
    if (!scope || !scope.profiles.some((p) => p.id === userId)) throw forbidden("You can't switch to that profile.");
    await d.db.session.deleteMany({ where: { id: scope.session.id } });
    await d.audit.record({ userId, action: 'auth.switch', system: 'SHERPA', object: 'Session', targetId: req.ctx.user.id, requestId: req.id, at: d.clock.now() });
    return issueSession(userId, scope.identity.email);
  });
  app.post('/v1/auth/sign-out', auth, async (req) => {
    const header = req.headers.authorization!.slice(7);
    const payload = app.jwt.decode<{ sid: string }>(header);
    if (payload?.sid) await d.db.session.deleteMany({ where: { id: payload.sid } });
    return { ok: true };
  });
  /** Phone channel (mock): push approval or 6-digit PIN; caller ID alone never suffices (C-12). */
  app.post('/v1/auth/phone/verify', async (req) => {
    const b = parse(z.object({ sessionId: z.string(), userId: z.string(), pin: z.string().regex(/^\d{6}$/).optional(), pushApproved: z.boolean().optional(), callerId: z.string().optional() }), req.body);
    const ok = await d.adapters.identity.verifyPhone({ userId: b.userId, pin: b.pin, pushApproved: b.pushApproved, callerId: b.callerId });
    await d.audit.record({ userId: b.userId, action: ok ? 'phone.verify.ok' : 'phone.verify.denied', system: 'SHERPA', object: 'PhoneSession', targetId: b.sessionId, requestId: req.id, at: d.clock.now() });
    return { ok };
  });
  app.get('/v1/me', auth, async (req) => req.ctx.user);
  app.get('/v1/me/features', auth, async () => d.flags.resolved);
  app.get('/v1/me/preferences', auth, async (req) => {
    const u = await d.db.user.findUnique({ where: { id: req.ctx.rmId } });
    return { ...readPrefs(u?.prefsJson ?? '{}'), phonePinSet: Boolean(u?.pinHash) };
  });
  app.put('/v1/me/preferences', auth, async (req) => {
    const p = parse(Preferences, req.body);
    await d.db.user.update({ where: { id: req.ctx.rmId }, data: { prefsJson: JSON.stringify(p) } });
    return p;
  });
  app.put('/v1/me/phone-pin', auth, async (req) => {
    const { pin } = parse(z.object({ pin: z.string().regex(/^\d{6}$/, 'Use 6 digits.') }), req.body);
    await d.db.user.update({ where: { id: req.ctx.rmId }, data: { pinHash: hashPin(pin) } });
    return { ok: true };
  });
  app.post('/v1/me/push-token', auth, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    await d.db.user.update({ where: { id: req.ctx.rmId }, data: { pushToken: token } });
    return { ok: true };
  });
  app.get('/v1/notifications', auth, async (req) => s.notifications.list(req.ctx));
  app.post('/v1/notifications/:id/read', auth, async (req) => s.notifications.markRead(req.ctx, id(req)));

  // ------------------------------------------------------------------ 2. today + accounts
  app.get('/v1/today', auth, async (req) => s.today.view(req.ctx));
  app.get('/v1/agenda', flag('F04_NUDGES'), async (req) => s.today.agenda(req.ctx));
  app.get('/v1/accounts', auth, async (req) => s.accounts.list(req.ctx, { query: q(req).query, segment: q(req).segment }));
  app.get('/v1/accounts/:id', auth, async (req) => s.accounts.detail(req.ctx, id(req)));
  app.get('/v1/meetings', auth, async (req) => {
    const from = q(req).from ? new Date(q(req).from!) : d.clock.today();
    const to = q(req).to ? new Date(q(req).to!) : new Date(from.getTime() + 86_400_000);
    return d.adapters.calendar.listMeetings(req.ctx, { from, to, ownerRmIds: req.ctx.bookRmIds });
  });

  // ------------------------------------------------------------------ 3. debrief (F01)
  app.post('/v1/debriefs/sessions', flag('F01_DEBRIEF'), async (req) => s.debriefs.start(req.ctx, parse(StartDebriefRequest, req.body)));
  app.get('/v1/debriefs/resumable', flag('F01_DEBRIEF'), async (req) => s.debriefs.resumable(req.ctx));
  app.get('/v1/debriefs/drafts/:id', flag('F01_DEBRIEF'), async (req) => s.debriefs.getDraft(req.ctx, id(req)));
  app.get('/v1/debriefs/drafts/:id/transcript', flag('F01_DEBRIEF'), async (req) => s.debriefs.transcriptFor(req.ctx, id(req)));
  app.patch('/v1/debriefs/drafts/:id', flag('F01_DEBRIEF'), async (req) => s.debriefs.patch(req.ctx, id(req), parse(DebriefDraftPatch, req.body)));
  app.post('/v1/debriefs/drafts/:id/chat', flag('F01_DEBRIEF'), async (req) => {
    metrics.inc('debrief.turns');
    return s.debriefs.chat(req.ctx, id(req), parse(ChatRequest, req.body).text);
  });
  app.post('/v1/debriefs/drafts/:id/intent', flag('F01_DEBRIEF'), async (req) => s.debriefs.intent(req.ctx, id(req)));
  app.post('/v1/debriefs/confirm', flag('F01_DEBRIEF'), async (req) => {
    metrics.inc('debrief.confirmed');
    return s.debriefs.confirm(req.ctx, parse(Confirmation, req.body));
  });
  app.get('/v1/debriefs/:id', flag('F01_DEBRIEF'), async (req) => s.debriefs.detail(req.ctx, id(req)));

  // ------------------------------------------------------------------ 4. brief (F02)
  app.get('/v1/briefs/meeting/:id', flag('F02_BRIEF'), async (req) => s.brief.forMeeting(req.ctx, id(req)));
  app.get('/v1/briefs/account/:id', flag('F02_BRIEF'), async (req) => s.brief.assemble(req.ctx, id(req), null));
  app.post('/v1/briefs/:id/ask', flag('F02_BRIEF'), async (req) => s.brief.ask(req.ctx, id(req), parse(AskBriefRequest, req.body).question));

  // ------------------------------------------------------------------ 5. follow-up drafts (F03) — intentionally no send endpoint
  app.post('/v1/debriefs/:id/drafts', flag('F03_DRAFTS'), async (req) => s.drafts.fromDebrief(req.ctx, id(req), parse(CreateDraftsRequest, req.body).kinds));
  app.get('/v1/debriefs/:id/drafts', flag('F03_DRAFTS'), async (req) => s.drafts.list(req.ctx, id(req)));
  app.patch('/v1/drafts/:id', flag('F03_DRAFTS'), async (req) => s.drafts.patch(req.ctx, id(req), parse(PatchDraftRequest, req.body)));
  app.post('/v1/drafts/:id/intent', flag('F03_DRAFTS'), async (req) => s.drafts.intent(req.ctx, id(req)));
  app.post('/v1/drafts/:id/save-to-mailbox', flag('F03_DRAFTS'), async (req) => {
    const c = parse(Confirmation, req.body);
    const intent = await d.gateway.getIntent(req.ctx, c.intentId);
    if (intent.kind !== 'mail.draft' || (intent.payload as { followUpDraftId: string }).followUpDraftId !== id(req)) throw new AppError('VALIDATION', 'That confirmation is for a different draft.');
    const r = await d.gateway.execute(req.ctx, c);
    return { mailDraftId: r.resultRef, result: r };
  });
  app.get('/v1/drafts/:id/recipients', flag('F03_DRAFTS'), async (req) => {
    const row = await d.db.followUpDraft.findUnique({ where: { id: id(req) } });
    if (!row || row.userId !== req.ctx.rmId) throw new AppError('NOT_FOUND', "That draft wasn't found.");
    return s.drafts.allowedRecipients(req.ctx, row.accountId);
  });

  // ------------------------------------------------------------------ 6. tasks (F04)
  app.get('/v1/tasks', auth, async (req) => s.tasks.list(req.ctx, { status: q(req).status as 'OPEN' | 'COMPLETED' | undefined, commitment: q(req).commitment === undefined ? undefined : q(req).commitment === 'true' }));
  app.post('/v1/tasks/:id/intent', flag('F04_NUDGES'), async (req) => s.tasks.intent(req.ctx, id(req), parse(TaskActionRequest, req.body)));
  app.post('/v1/tasks/confirm', flag('F04_NUDGES'), async (req) => s.tasks.confirm(req.ctx, parse(Confirmation, req.body)));
  /** Generic confirm for intents prepared elsewhere (alerts → task, coverage → task/hold). */
  app.post('/v1/intents/confirm', auth, async (req) => d.gateway.execute(req.ctx, parse(Confirmation, req.body)));
  app.get('/v1/intents/:id', auth, async (req) => d.gateway.getIntent(req.ctx, id(req)));

  // ------------------------------------------------------------------ 7. referrals (F05)
  app.get('/v1/referrals', flag('F05_REFERRALS'), async (req) => s.referrals.list(req.ctx, q(req).accountId));
  app.get('/v1/referrals/route', flag('F05_REFERRALS'), async (req) => s.referrals.preview(req.ctx, q(req).accountId ?? '', parse(Specialty, q(req).specialty)));
  app.get('/v1/referrals/prefill/:id', flag('F05_REFERRALS'), async (req) => s.referrals.prefill(req.ctx, id(req)));
  app.post('/v1/referrals/intent', flag('F05_REFERRALS'), async (req) => s.referrals.intent(req.ctx, parse(ReferralIntentRequest, req.body)));
  app.post('/v1/referrals/confirm', flag('F05_REFERRALS'), async (req) => d.gateway.execute(req.ctx, parse(Confirmation, req.body)));

  // ------------------------------------------------------------------ 8. alerts (F06)
  app.get('/v1/alerts', flag('F06_WATCHLIST'), async (req) => s.alerts.list(req.ctx, { status: (q(req).status as 'open' | 'snoozed' | 'all' | undefined) ?? 'open' }));
  app.post('/v1/alerts/:id/action', flag('F06_WATCHLIST'), async (req) => s.alerts.act(req.ctx, id(req), parse(AlertActionRequest, req.body)));
  app.post('/v1/alerts/refresh', flag('F06_WATCHLIST'), async (req) => s.alerts.refresh(req.ctx));

  // ------------------------------------------------------------------ 9. deals (F07)
  app.post('/v1/deals/sessions', flag('F07_DEAL_INTAKE'), async (req) => {
    const b = parse(z.object({ accountId: z.string(), fromDebriefId: z.string().optional() }), req.body);
    return s.deals.start(req.ctx, b.accountId, b.fromDebriefId);
  });
  app.get('/v1/deals/:id', flag('F07_DEAL_INTAKE'), async (req) => s.deals.get(req.ctx, id(req)));
  app.patch('/v1/deals/:id', flag('F07_DEAL_INTAKE'), async (req) => s.deals.patch(req.ctx, id(req), parse(DealDraftPatch, req.body)));
  app.post('/v1/deals/:id/chat', flag('F07_DEAL_INTAKE'), async (req) => s.deals.turn(req.ctx, id(req), parse(ChatRequest, req.body).text));
  app.post('/v1/deals/:id/intent', flag('F07_DEAL_INTAKE'), async (req) => s.deals.intent(req.ctx, id(req)));
  app.post('/v1/deals/confirm', flag('F07_DEAL_INTAKE'), async (req) => d.gateway.execute(req.ctx, parse(Confirmation, req.body)));

  // ------------------------------------------------------------------ 10. documents (F08)
  app.get('/v1/documents', flag('F08_DOC_CHASE'), async (req) => s.docs.list(req.ctx, q(req).accountId));
  app.post('/v1/documents/:id/request-draft', flag('F08_DOC_CHASE'), async (req) => {
    const b = parse(DocumentRequestDraftRequest, req.body);
    return s.drafts.documentRequest(req.ctx, id(req), b.itemIds, b.reminderDays);
  });
  app.post('/v1/documents/:id/mark', flag('F08_DOC_CHASE'), async (req) => s.docs.mark(req.ctx, id(req), parse(z.object({ status: z.enum(['RECEIVED', 'WAIVED']) }), req.body).status));

  // ------------------------------------------------------------------ 11. talking points (F09)
  app.get('/v1/accounts/:id/talking-points', flag('F09_TALKING_POINTS'), async (req) => s.talking.forAccount(req.ctx, id(req)));
  app.post('/v1/talking-points/:id/feedback', flag('F09_TALKING_POINTS'), async (req) => s.talking.feedback(req.ctx, decodeURIComponent(id(req)), parse(z.object({ feedback: z.enum(['UP', 'DOWN']) }), req.body).feedback));

  // ------------------------------------------------------------------ 12. coverage (F10)
  app.get('/v1/coverage', flag('F10_COVERAGE'), async (req) => s.coverage.plan(req.ctx));
  app.post('/v1/coverage/:id/action', flag('F10_COVERAGE'), async (req) => s.coverage.action(req.ctx, id(req), parse(CoverageActionRequest, req.body)));
  app.get('/v1/coverage/team', flag('F10_COVERAGE'), async (req) => s.coverage.team(req.ctx));

  // ------------------------------------------------------------------ 13. gated (404 unless active — F11-AC1)
  app.post('/v1/live/sessions', flag('F11_LIVE_LISTENING'), async (req) => s.live.start(req.ctx, parse(LiveStartRequest, req.body)));
  app.post('/v1/live/sessions/:id/segments', flag('F11_LIVE_LISTENING'), async (req) => s.live.segment(req.ctx, id(req), parse(ChatRequest, req.body).text));
  app.post('/v1/live/sessions/:id/stop', flag('F11_LIVE_LISTENING'), async (req) => s.live.stop(req.ctx, id(req)));
  app.post('/v1/pricing/guidance', flag('F12_PRICING_GUIDANCE'), async (req) => s.pricing.guidance(req.ctx, parse(z.object({ dealId: z.string() }), req.body).dealId));
  app.get('/v1/health-scores', flag('F13_HEALTH_SCORE'), async (req) => s.health.list(req.ctx, q(req).band));
  app.get('/v1/accounts/:id/health', flag('F13_HEALTH_SCORE'), async (req) => s.health.compute(req.ctx, id(req), true));

  // ------------------------------------------------------------------ 14. compliance
  app.get('/v1/compliance/queue', auth, async (req) => s.compliance.queue(req.ctx, q(req).type as 'COMPLAINT' | 'MNPI' | 'SENSITIVE' | undefined));
  app.post('/v1/compliance/queue/:id/resolve', auth, async (req) => s.compliance.resolve(req.ctx, id(req), parse(z.object({ note: z.string().min(1) }), req.body).note));
  app.get('/v1/compliance/audit', auth, async (req) => s.compliance.audit(req.ctx, { accountId: q(req).accountId, rmId: q(req).rmId }));

  // ------------------------------------------------------------------ 15. ask
  app.post('/v1/ask', auth, async (req) => {
    metrics.inc('ask.requests');
    return s.ask.handle(req.ctx, parse(AskRequest, req.body));
  });

  // ------------------------------------------------------------------ dev only
  if (d.config.NODE_ENV !== 'production') {
    app.get('/v1/admin/metrics', async () => ({ ...metrics.snapshot(), now: d.clock.now().toISOString() }));
    app.post('/v1/dev/mock-failure', async (req) => {
      const b = parse(z.object({ adapter: z.string(), failing: z.boolean() }), req.body);
      await setMockFailure(d.db, b.adapter, b.failing);
      return { ok: true };
    });
    app.post('/v1/dev/telephony/inbound', async (req) => d.adapters.telephony.simulateInboundCall(parse(z.object({ callerId: z.string() }), req.body).callerId));
  }
}
