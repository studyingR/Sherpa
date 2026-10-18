import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Deps } from '../deps';
import { AppError } from '../lib/errors';
import { buildContext, type UserContext } from './entitlements';

export interface TokenPayload {
  sub: string;
  sid: string;
}

/** Verifies the session JWT and resolves entitlements for every authenticated request (C-08). */
export async function contextFromToken(d: Deps, app: FastifyInstance, token: string, requestId: string): Promise<UserContext> {
  let payload: TokenPayload;
  try {
    payload = app.jwt.verify<TokenPayload>(token);
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');
  }
  const session = await d.db.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.expiresAt < new Date()) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');
  const user = await d.adapters.identity.getUser(payload.sub);
  if (!user) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');
  return buildContext(d.db, user, requestId);
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { deps: Deps }) => {
  await app.register(jwt, { secret: opts.deps.config.JWT_SECRET });
  app.decorateRequest('ctx', null as unknown as UserContext);
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    req.ctx = await contextFromToken(opts.deps, app, header.slice(7), req.id);
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}
