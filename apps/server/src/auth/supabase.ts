/**
 * Google sign-in via Supabase Auth. The app completes Google OAuth with Supabase (PKCE) and sends us the
 * Supabase access token; we verify it against the project's signing keys, check the email allowlist, and
 * issue a normal Sherpa session. Nothing else in the server depends on how the user signed in.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '../config';
import { AppError } from '../lib/errors';

export interface VerifiedIdentity {
  email: string;
  provider: string;
  subject: string;
}

interface SupabaseClaims extends JWTPayload {
  email?: string;
  app_metadata?: { provider?: string; providers?: string[] };
  user_metadata?: { email_verified?: boolean };
}

export function createSupabaseVerifier(config: Config) {
  if (!config.SUPABASE_URL) return null;
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : null;

  return async function verify(token: string): Promise<VerifiedIdentity> {
    let payload: SupabaseClaims;
    try {
      const opts = { issuer, audience: 'authenticated' };
      payload = (secret ? await jwtVerify(token, secret, opts) : await jwtVerify(token, jwks, opts)).payload as SupabaseClaims;
    } catch {
      throw new AppError('UNAUTHENTICATED', "We couldn't verify that sign-in. Try again.");
    }
    const providers = payload.app_metadata?.providers ?? [payload.app_metadata?.provider];
    if (!providers.includes('google')) throw new AppError('UNAUTHENTICATED', 'Sign in with your Google account.');
    if (!payload.email || payload.user_metadata?.email_verified === false) {
      throw new AppError('UNAUTHENTICATED', 'Your Google account needs a verified email.');
    }
    return { email: payload.email.toLowerCase(), provider: 'google', subject: String(payload.sub) };
  };
}
