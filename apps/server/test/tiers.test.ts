import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateProductGaps } from '../src/services/rules';
import { G1, runDebrief, setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeEach(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
});

describe('F05 referrals', () => {
  it('F05-AC1: confirming creates exactly one Referral__c routed per the rules table', async () => {
    const intent = (await h.as(maya).post('/v1/referrals/intent', { accountId: '001Mock000000Acme1', specialty: 'FX', needSummary: 'Paying a German supplier', urgency: 'NORMAL', consentToShare: true })).json();
    expect(intent.route).toMatchObject({ queue: 'FX Desk – Northeast', userId: 'u_carla', fallback: false });
    await h.as(maya).post('/v1/referrals/confirm', { intentId: intent.id, channel: 'tap', approvals: {} });
    expect(await h.db.mockSfReferral.count()).toBe(1);
    const refs = (await h.as(maya).get('/v1/referrals?accountId=001Mock000000Acme1')).json();
    expect(refs[0]).toMatchObject({ specialty: 'FX', status: 'SUBMITTED', routedTo: { queue: 'FX Desk – Northeast' } });
  });

  it('F05-AC2: a specialty with no matching rule falls back to the default queue', async () => {
    const intent = (await h.as(maya).post('/v1/referrals/intent', { accountId: '001Mock000000Acme1', specialty: 'CAPITAL_MARKETS', needSummary: 'Rate hedge', urgency: 'LOW', consentToShare: true })).json();
    expect(intent.route).toMatchObject({ queue: 'Specialist Referrals – Unassigned', fallback: true });
  });

  it('F05-FR6: debrief specialist interest prefills the referral', async () => {
    const r = await runDebrief(h, maya, G1);
    const p = (await h.as(maya).get(`/v1/referrals/prefill/${r.replies[4].writeResult!.debriefId}`)).json();
    expect(p.specialty).toBe('FX');
    expect(p.needSummary).toMatch(/German supplier/);
  });
});

describe('F06 watchlist alerts', () => {
  it('F06-AC1: seed data produces exactly the expected alert set', async () => {
    const alerts = (await h.as(maya).get('/v1/alerts?status=all')).json() as { accountName: string; rule: string; severity: string }[];
    const got = alerts.map((a) => `${a.accountName}|${a.rule}|${a.severity}`).sort();
    expect(got).toEqual([
      'Castell Foods|COVENANT_BREACH_RISK|CRITICAL',
      'Castell Foods|COVENANT_TEST_DUE|INFO',
      'Castell Foods|FINANCIALS_PAST_DUE|WARN',
      'Harbor Logistics|MATURITY_APPROACHING|WARN',
      'Harbor Logistics|UTILIZATION_SWING|WARN',
      'Northgate Dental Partners|DEPOSIT_OUTFLOW|WARN',
      'Riverline Plastics|RISK_RATING_DOWNGRADE|CRITICAL',
    ]);
  });

  it('F06-FR4: re-evaluating does not duplicate open alerts', async () => {
    const before = await h.db.alert.count();
    await h.as(maya).post('/v1/alerts/refresh');
    expect(await h.db.alert.count()).toBe(before);
  });

  it('F06-AC2: snoozed alerts reappear after the snooze period', async () => {
    const castell = ((await h.as(maya).get('/v1/alerts')).json() as { id: string; rule: string }[]).find((a) => a.rule === 'COVENANT_BREACH_RISK')!;
    await h.as(maya).post(`/v1/alerts/${castell.id}/action`, { action: 'SNOOZE', snoozeDays: 7 });
    expect(((await h.as(maya).get('/v1/alerts?status=snoozed')).json() as { id: string }[]).map((a) => a.id)).toContain(castell.id);
    expect(((await h.as(maya).get('/v1/alerts')).json() as { id: string }[]).map((a) => a.id)).not.toContain(castell.id);
    h.clock.advance(7 * 86_400_000 + 60_000);
    expect(((await h.as(maya).get('/v1/alerts')).json() as { id: string }[]).map((a) => a.id)).toContain(castell.id);
  });

  it('F06-FR3: alert actions are audited; create-task returns an intent', async () => {
    const a = ((await h.as(maya).get('/v1/alerts')).json() as { id: string }[])[0];
    await h.as(maya).post(`/v1/alerts/${a.id}/action`, { action: 'ACK' });
    expect(await h.db.auditEvent.count({ where: { action: 'alert.ack', targetId: a.id } })).toBe(1);
    const intent = (await h.as(maya).post(`/v1/alerts/${a.id}/action`, { action: 'CREATE_TASK' })).json();
    expect(intent.kind).toBe('task.create');
  });
});

describe('F07 deal intake', () => {
  const SCRIPT = 'They need a 2.5 million equipment loan to buy new CNC machines for the Newark expansion, five-year term, secured by the equipment, and they want to close by end of Q1. Jane Ruiz will guarantee.';

  it('F07-AC2: an amount/term/collateral read-back is required before draft creation', async () => {
    const s = (await h.as(maya).post('/v1/deals/sessions', { accountId: '001Mock000000Acme1' })).json();
    const t1 = (await h.as(maya).post(`/v1/deals/${s.dealDraftId}/chat`, { text: SCRIPT })).json();
    expect(t1.messages.at(-1).text).toMatch(/two point five million — 2,500,000 dollars, 5-year term, secured by the equipment\. Is that right\?/);
    const early = await h.as(maya).post(`/v1/deals/${s.dealDraftId}/intent`);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.details.code).toBe('READBACK_REQUIRED');
  });

  it('F07-AC1: scripted intake creates an nCino DRAFT with all required fields; nothing is submitted', async () => {
    const s = (await h.as(maya).post('/v1/deals/sessions', { accountId: '001Mock000000Acme1' })).json();
    await h.as(maya).post(`/v1/deals/${s.dealDraftId}/chat`, { text: SCRIPT });
    await h.as(maya).post(`/v1/deals/${s.dealDraftId}/chat`, { text: 'Yes, that is right.' });
    const done = (await h.as(maya).post(`/v1/deals/${s.dealDraftId}/chat`, { text: 'Create draft' })).json();
    expect(done.draft).toMatchObject({ status: 'DRAFT_CREATED', product: 'EQUIPMENT', amount: 2_500_000, termMonths: 60, collateral: 'the equipment', guarantors: ['Jane Ruiz'] });
    const req = await h.db.mockNcinoDraftRequest.findFirst();
    expect(req!.status).toBe('Draft — RM review');
    expect(await h.db.mockCallLog.count({ where: { adapter: 'nCino', method: { contains: 'submit' } } })).toBe(0);
    expect(await h.db.mockCallLog.count({ where: { adapter: 'EventBus', method: 'deal.draft_created' } })).toBe(1);
  });
});

describe('F08 documents', () => {
  it('F08-AC1: Castell shows overdue Q2 financials and a drafted request lists them', async () => {
    const docs = (await h.as(maya).get('/v1/documents?accountId=001Mock000000Cast1')).json() as { id: string; type: string; period: string; daysOverdue: number }[];
    const q2 = docs.find((d) => d.type === 'FINANCIAL_STATEMENT')!;
    expect(q2).toMatchObject({ period: 'Q2', daysOverdue: 3 }); // docs/07: "Q2 financials 3 days overdue"
    const draft = (await h.as(maya).post('/v1/documents/001Mock000000Cast1/request-draft', { itemIds: [q2.id], reminderDays: [7, 14] })).json();
    expect(draft.body).toMatch(/Financial statements \(Q2\)/);
    expect(draft.to[0].name).toBe('Mark Castell');
  });

  it('F08-AC2: the reminder schedule creates draft reminders, never sends', async () => {
    const draft = (await h.as(maya).post('/v1/documents/001Mock000000Cast1/request-draft', { itemIds: ['TCK-CAST-Q2FS'], reminderDays: [7, 14] })).json();
    const intent = (await h.as(maya).post(`/v1/drafts/${draft.id}/intent`)).json();
    await h.as(maya).post(`/v1/drafts/${draft.id}/save-to-mailbox`, { intentId: intent.id, channel: 'tap', approvals: {} });
    const mails = await h.db.mockMailDraft.findMany({ orderBy: { createdAt: 'asc' } });
    expect(mails).toHaveLength(3);
    expect(mails.filter((m) => m.scheduledFor).map((m) => m.scheduledFor)).toEqual(['2026-10-26', '2026-11-02']);
  });

  it('F08-FR4: marking an item received is audited', async () => {
    await h.as(maya).post('/v1/documents/TCK-CAST-Q2FS/mark', { status: 'RECEIVED' });
    expect(await h.db.auditEvent.count({ where: { action: 'document.received' } })).toBe(1);
  });
});

describe('F09 talking points', () => {
  it('F09-AC1: each talking point references at least one evidence item', async () => {
    const tps = (await h.as(maya).get('/v1/accounts/001Mock000000Acme1/talking-points')).json() as { ruleId: string; evidence: unknown[] }[];
    expect(tps.length).toBeGreaterThan(0);
    for (const t of tps) expect(t.evidence.length).toBeGreaterThan(0);
    expect(tps.map((t) => t.ruleId)).toEqual(expect.arrayContaining(['TP_FX_NO_PRODUCT', 'TP_POSPAY', 'TP_SWEEP']));
  });

  it('F09-AC2: removing a holding changes the gap suggestions deterministically', () => {
    const base = { accountName: 'Acme', industry: 'Industrial machinery', intlWiresPerMonth: 2, wireAchMonthly: 410, avgCollectedBalance: 4_100_000, fxMentioned: false, capexMentioned: false, daysToNearestMaturity: 400, asOf: '2026-10-19' };
    const withPosPay = evaluateProductGaps({ ...base, products: ['Operating account', 'Positive Pay'] }).map((g) => g.ruleId);
    const without = evaluateProductGaps({ ...base, products: ['Operating account'] }).map((g) => g.ruleId);
    expect(withPosPay).not.toContain('TP_POSPAY');
    expect(without).toContain('TP_POSPAY');
    expect(evaluateProductGaps({ ...base, products: ['Operating account'] }).map((g) => g.ruleId)).toEqual(without);
  });

  it('F09-FR4: feedback is stored', async () => {
    await h.as(maya).post(`/v1/talking-points/${encodeURIComponent('001Mock000000Acme1:TP_POSPAY')}/feedback`, { feedback: 'UP' });
    expect(await h.db.talkingPointFeedback.count()).toBe(1);
  });
});

describe('F10 coverage', () => {
  it('F10-AC1: seed data produces the expected overdue list and plan ordering', async () => {
    const c = (await h.as(maya).get('/v1/coverage')).json();
    const overdue = c.items.filter((i: { overdueBy: number }) => i.overdueBy > 0).map((i: { accountName: string }) => i.accountName);
    expect(overdue).toEqual(['Northgate Dental Partners']);
    expect(c.plan.items[0].accountName).toBe('Northgate Dental Partners');
    expect(c.plan.items.length).toBeGreaterThanOrEqual(5);
    expect(c.plan.items[0].reasons[0]).toBe('96 days since last touch');
  });

  it('F10-FR4: accept creates a task intent; schedule creates a calendar hold intent', async () => {
    const accept = (await h.as(maya).post('/v1/coverage/001Mock000000Nrth1/action', { action: 'ACCEPT' })).json();
    expect(accept.kind).toBe('task.create');
    await h.as(maya).post('/v1/intents/confirm', { intentId: accept.id, channel: 'tap', approvals: {} });
    expect(await h.db.mockSfTask.count({ where: { subject: 'Reach out to Northgate Dental Partners' } })).toBe(1);
    const hold = (await h.as(maya).post('/v1/coverage/001Mock000000Pine1/action', { action: 'SCHEDULE' })).json();
    expect(hold.kind).toBe('calendar.hold');
  });

  it('F10-AC2: a leader sees coverage % per RM but no client details', async () => {
    const sam = await h.signIn('u_sam');
    const team = (await h.as(sam).get('/v1/coverage/team')).json() as { name: string; coveragePct: number }[];
    expect(team.map((t) => t.name)).toEqual(['Devon Brooks', 'Maya Chen']);
    expect(JSON.stringify(team)).not.toMatch(/Acme|Northgate/);
    expect((await h.as(sam).get('/v1/accounts')).statusCode).toBe(403);
    expect((await h.as(sam).get('/v1/accounts/001Mock000000Acme1')).statusCode).toBe(403);
    expect((await h.as(maya).get('/v1/coverage/team')).statusCode).toBe(403);
  });
});
