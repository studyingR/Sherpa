import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { FlagName } from '@sherpa/shared';
import type { UserContext } from '../auth/entitlements';
import { AppError } from './errors';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: UserContext;
  }
}

/** All API inputs are validated with zod schemas from packages/shared (422 on failure). */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION', 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

export type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface FlagGuard {
  (flag: FlagName): (req: FastifyRequest) => Promise<void>;
}

/** Simple in-process counters for /v1/admin/metrics (dev only, docs/05 §12). */
export const metrics = {
  counters: new Map<string, number>(),
  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  },
  snapshot() {
    return Object.fromEntries(this.counters);
  },
};
