import { beforeAll, describe, expect, it } from 'vitest';
import { seed } from '@sherpa/db';
import { loadConfig } from '../src/config';
import { setup, testDb, TODAY, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeAll(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
});

describe('M0 foundations', () => {
  it('lists personas and signs in with a JWT', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/auth/personas' });
    expect((r.json() as { id: string }[]).map((p) => p.id)).toEqual(['u_maya', 'u_devon', 'u_priya', 'u_sam', 'u_jordan']);
    expect(maya).toMatch(/^ey/);
  });

  it('rejects requests without a session (401)', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/v1/today' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('Today for Maya shows the Acme pending debrief and seeded commitments', async () => {
    const v = (await h.as(maya).get('/v1/today')).json();
    expect(v.pendingDebriefs.map((p: { accountName: string }) => p.accountName)).toEqual(['Acme Manufacturing']);
    expect(v.commitmentsDue[0].subject).toBe('Send renewal documents to Ellen Ward');
    expect(v.meetings.length).toBe(3);
  });

  it('C-08 / M0: Maya cannot fetch Devon’s account (403)', async () => {
    const r = await h.as(maya).get('/v1/accounts/001Mock000000Gree1');
    expect(r.statusCode).toBe(403);
    const list = (await h.as(maya).get('/v1/accounts')).json() as { ownerRmId: string }[];
    expect(list).toHaveLength(8);
    expect(list.every((a) => a.ownerRmId === 'u_maya')).toBe(true);
  });

  it('F11-AC1 / M0: inactive features return 404 even before auth', async () => {
    for (const [method, url] of [['POST', '/v1/live/sessions'], ['POST', '/v1/pricing/guidance'], ['GET', '/v1/health-scores']] as const) {
      expect((await h.app.inject({ method, url, payload: {} })).statusCode).toBe(404);
      expect((await h.as(maya)[method === 'GET' ? 'get' : 'post'](url, {})).statusCode).toBe(404);
    }
    const f = (await h.as(maya).get('/v1/me/features')).json();
    expect(f).toMatchObject({ F01_DEBRIEF: true, F11_LIVE_LISTENING: false, F12_PRICING_GUIDANCE: false, F13_HEALTH_SCORE: false });
  });

  it('seed is deterministic for a given SEED_TODAY', async () => {
    const db = testDb();
    const snapshot = async () => (await db.mockSfAccount.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, tier: true } }));
    const a = await snapshot();
    await seed(db, TODAY);
    const b = await snapshot();
    expect(b).toEqual(a);
    expect(a).toHaveLength(53);
  });

  it('config validation: openai mode needs a key and model names', () => {
    expect(() => loadConfig({ LLM_MODE: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ LLM_MODE: 'openai', OPENAI_API_KEY: 'x' })).toThrow(/OPENAI_MODEL/);
  });

  it('M9: INTEGRATIONS_MODE=live without credentials fails fast with a clear message', () => {
    expect(() => loadConfig({ INTEGRATIONS_MODE: 'live' })).toThrow(/needs credentials.*SF_INSTANCE_URL/);
  });

  it('returns the error envelope for validation problems (422)', async () => {
    maya = await h.signIn('u_maya'); // the determinism test reseeded (and cleared sessions)
    const r = await h.as(maya).post('/v1/debriefs/sessions', { channel: 'NOPE' });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });
});
