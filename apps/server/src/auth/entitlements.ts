import { randomUUID } from 'node:crypto';
import type { Db } from '@sherpa/db';
import type { RequestContext } from '@sherpa/adapters';
import type { User } from '@sherpa/shared';
import { forbidden } from '../lib/errors';

/** Analysts work on the book of the RM(s) they support. */
const SUPPORTS: Record<string, string[]> = { u_priya: ['u_maya'] };

export interface UserContext extends RequestContext {
  user: User;
  /** RM ids whose book this user acts on. */
  bookRmIds: string[];
}

/**
 * Entitlements (rule 4, C-08): resolves the user's book. RMs: own accounts. Analysts: supported RMs' accounts.
 * Leaders: no client book (team coverage percentages only). Compliance: no client book.
 */
export async function buildContext(db: Db, user: User, requestId: string = randomUUID()): Promise<UserContext> {
  let bookRmIds: string[] = [];
  let teamRmIds: string[] = [];
  if (user.role === 'RM') bookRmIds = [user.id];
  if (user.role === 'ANALYST') bookRmIds = SUPPORTS[user.id] ?? [];
  if (user.role === 'LEADER' && user.teamId) {
    teamRmIds = (await db.user.findMany({ where: { teamId: user.teamId, role: 'RM' }, select: { id: true } })).map((u) => u.id);
  }
  const accounts = bookRmIds.length
    ? await db.mockSfAccount.findMany({ where: { ownerRmId: { in: bookRmIds } }, select: { id: true } })
    : [];
  return {
    rmId: user.id,
    role: user.role,
    user,
    bookRmIds,
    bookAccountIds: new Set(accounts.map((a) => a.id)),
    teamRmIds,
    requestId,
  };
}

export function assertInBook(ctx: UserContext, accountId: string | null | undefined): void {
  if (!accountId || !ctx.bookAccountIds.has(accountId)) throw forbidden();
}

export function assertRole(ctx: UserContext, ...roles: User['role'][]): void {
  if (!roles.includes(ctx.user.role)) throw forbidden("Your role doesn't have access to this.");
}
