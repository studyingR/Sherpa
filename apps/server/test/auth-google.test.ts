import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { setup, type Harness } from './helpers';

const SUPABASE_URL = 'https://testproj.supabase.co';
const SECRET = 'supabase-test-jwt-secret-at-least-32-chars!!';
let h: Harness;

async function supabaseToken(email: string, provider = 'google', secret = SECRET) {
  return new SignJWT({ email, app_metadata: { provider, providers: [provider] }, user_metadata: { email_verified: true }, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-2222-3333-4444-555555555555')
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

beforeAll(async () => {
  h = await setup({ env: { AUTH_MODE: 'supabase', SUPABASE_URL, SUPABASE_JWT_SECRET: SECRET } });
  await h.db.authIdentity.deleteMany();
  await h.db.authIdentity.create({ data: { email: 'rm.tester@example.com', userId: 'u_maya' } });
});

describe('Google sign-in via Supabase', () => {
  it('advertises Google and hides test profiles', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({ personas: false, google: true });
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/personas' })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/sign-in', payload: { personaId: 'u_maya' } })).statusCode).toBe(403);
  });

  it('an allowlisted Google account gets a Sherpa session for its mapped user', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/v1/auth/supabase', payload: { accessToken: await supabaseToken('RM.Tester@example.com') } });
    expect(r.statusCode).toBe(200);
    const { token, user } = r.json();
    expect(user.id).toBe('u_maya');
    expect((await h.as(token).get('/v1/accounts')).json()).toHaveLength(8);
    expect(await h.db.auditEvent.count({ where: { action: 'auth.signin.google', userId: 'u_maya' } })).toBe(1);
  });

  it('an account that is not on the allowlist is refused (403) and audited', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/v1/auth/supabase', payload: { accessToken: await supabaseToken('stranger@example.com') } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.message).toMatch(/isn't set up for Sherpa/);
    expect(await h.db.auditEvent.count({ where: { action: 'auth.denied' } })).toBeGreaterThan(0);
  });

  it('rejects forged tokens and non-Google providers', async () => {
    const forged = await supabaseToken('rm.tester@example.com', 'google', 'some-other-secret-that-is-long-enough!!');
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/supabase', payload: { accessToken: forged } })).statusCode).toBe(401);
    const email = await supabaseToken('rm.tester@example.com', 'email');
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/supabase', payload: { accessToken: email } })).statusCode).toBe(401);
  });

  it('production refuses persona sign-in and the dev JWT secret', async () => {
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'personas' })).toThrow(/AUTH_MODE/);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'supabase', SUPABASE_URL })).toThrow(/JWT_SECRET/);
  });
});
