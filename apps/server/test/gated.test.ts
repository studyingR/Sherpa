import { beforeAll, describe, expect, it } from 'vitest';
import { HEALTH_INPUT_ALLOWLIST, scoreHealth, type HealthInputs } from '../src/services/rules';
import { ALL_FLAGS_ON, setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeAll(async () => {
  h = await setup({ flags: ALL_FLAGS_ON });
  maya = await h.signIn('u_maya');
});

describe('F11 live listening (flags on)', () => {
  it('F11-AC2: start is blocked without consent in an all-party-consent state (422)', async () => {
    const r = await h.as(maya).post('/v1/live/sessions', { meetingId: '00UMock00000Harb01', jurisdiction: 'PA', allPartyConsentConfirmed: false, consentStatement: 'Everyone agreed.' });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('F11-FR1/FR3/FR5: consented session records consent, keeps text in memory, and stops into review', async () => {
    const s = (await h.as(maya).post('/v1/live/sessions', { meetingId: '00UMock00000Harb01', jurisdiction: 'PA', allPartyConsentConfirmed: true, consentStatement: 'Everyone agreed.' })).json();
    expect(await h.db.consentRecord.count({ where: { meetingId: '00UMock00000Harb01', allPartyRequired: true } })).toBe(1);
    const seg = (await h.as(maya).post(`/v1/live/sessions/${s.sessionId}/segments`, { text: "Ana said the renewal pricing was frustrating. I'll send renewal options by Friday." })).json();
    expect(seg.captured.flags[0].flag).toBe('COMPLAINT');
    expect(await h.db.transcriptSegment.count({ where: { voiceSessionId: s.sessionId } })).toBe(0); // not stored before confirm
    const stop = (await h.as(maya).post(`/v1/live/sessions/${s.sessionId}/stop`)).json();
    const draft = (await h.as(maya).get(`/v1/debriefs/drafts/${stop.draftId}`)).json();
    expect(draft).toMatchObject({ status: 'REVIEW', flags: { complaint: { flagged: true } } });
    const intent = (await h.as(maya).post(`/v1/debriefs/drafts/${stop.draftId}/intent`)).json();
    await h.as(maya).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: {} });
    expect(await h.db.transcriptSegment.count({ where: { voiceSessionId: s.sessionId } })).toBeGreaterThan(0); // stored after confirm
  });
});

describe('F12 pricing guidance (flags on)', () => {
  it('F12-AC2: every guidance request creates an audit record; F12-FR2 disclaimer', async () => {
    const s = (await h.as(maya).post('/v1/deals/sessions', { accountId: '001Mock000000Acme1' })).json();
    await h.as(maya).patch(`/v1/deals/${s.dealDraftId}`, { product: 'EQUIPMENT', amount: 2_500_000, termMonths: 60 });
    const before = await h.db.auditEvent.count({ where: { action: 'pricing.view' } });
    const g = (await h.as(maya).post('/v1/pricing/guidance', { dealId: s.dealDraftId })).json();
    await h.as(maya).post('/v1/pricing/guidance', { dealId: s.dealDraftId });
    expect(await h.db.auditEvent.count({ where: { action: 'pricing.view' } })).toBe(before + 2);
    expect(await h.db.pricingView.count()).toBeGreaterThanOrEqual(2);
    expect(g.disclaimer).toBe('Indicative internal guidance. Not a quote. Subject to credit approval and pricing authority.');
    expect(g.spreadBpsRange[1]).toBeGreaterThan(g.spreadBpsRange[0]);
  });

  it('F12-AC1: guidance never appears in a generated client email', async () => {
    const debrief = await import('./helpers').then((m) => m.runDebrief(h, maya, m.G1));
    const drafts = (await h.as(maya).post(`/v1/debriefs/${debrief.replies[4].writeResult!.debriefId}/drafts`, { kinds: ['CLIENT'] })).json();
    expect(drafts[0].body).not.toMatch(/bps|basis points|spread|RAROC|SOFR|%/i);
  });
});

describe('F13 health scoring (flags on)', () => {
  it('F13-AC1: seed data produces the expected bands for the 5 named accounts', async () => {
    const scores = (await h.as(maya).get('/v1/health-scores')).json() as { accountName: string; band: string; drivers: unknown[] }[];
    const band = (n: string) => scores.find((s) => s.accountName === n)?.band;
    expect(band('Summit Ridge Builders')).toBe('HEALTHY');
    expect(band('Acme Manufacturing')).toBe('HEALTHY');
    expect(band('Harbor Logistics')).toBe('WATCH');
    expect(band('Castell Foods')).toBe('WATCH');
    expect(band('Northgate Dental Partners')).toBe('AT_RISK');
    for (const s of scores) expect(s.drivers.length).toBeLessThanOrEqual(3);
  });

  it('F13-FR2: every score shows its top drivers with values and sources', async () => {
    const s = (await h.as(maya).get('/v1/accounts/001Mock000000Nrth1/health')).json();
    expect(s.drivers[0].fact).toMatchObject({ source: expect.any(String), asOf: expect.any(String) });
    expect(s.history.length).toBeGreaterThan(0);
  });

  it('F13-AC2 / C-17: a non-allowlisted input field fails', () => {
    const ok: HealthInputs = { depositTrendPct: 0, utilizationChangePts: 0, daysSinceTouch: 10, complaints12m: 0, referrals12m: 0, productCount: 5, maturityWithoutRenewalDays: null };
    expect(scoreHealth(ok).band).toBe('HEALTHY');
    expect(() => scoreHealth({ ...ok, zipCode: 8901 } as unknown as HealthInputs)).toThrow(/not on the allowlist/);
    expect(HEALTH_INPUT_ALLOWLIST).not.toContain('zipCode');
    expect(HEALTH_INPUT_ALLOWLIST.some((k) => /zip|age|race|gender|ethnic|owner/i.test(k))).toBe(false);
  });

  it('F13-FR3: at-risk accounts appear on Today', async () => {
    const v = (await h.as(maya).get('/v1/today')).json();
    expect(v.atRisk.map((x: { accountName: string }) => x.accountName)).toContain('Northgate Dental Partners');
  });
});

describe('Compliance role', () => {
  it('can query the audit log read-only; RMs cannot', async () => {
    const jordan = await h.signIn('u_jordan');
    const audit = (await h.as(jordan).get('/v1/compliance/audit?accountId=001Mock000000Acme1')).json();
    expect(Array.isArray(audit)).toBe(true);
    expect((await h.as(maya).get('/v1/compliance/audit')).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'DELETE', url: '/v1/compliance/audit' })).statusCode).toBe(404);
  });
});
