import { randomUUID } from 'node:crypto';
import type { Db } from '@sherpa/db';
import type { AuditEvent, Source } from '@sherpa/shared';

export interface AuditInput {
  userId: string;
  action: string;
  system: Source;
  object: string;
  targetId?: string;
  accountId?: string | null;
  intentId?: string;
  confirmation?: { channel: 'voice' | 'tap'; utterance?: string };
  before?: unknown;
  after?: unknown;
  requestId: string;
  at: Date;
}

/**
 * Append-only audit log (docs/08 §2). This module exposes `record` and read queries only:
 * there is deliberately no update or delete path.
 */
export function createAudit(db: Db) {
  return {
    async record(e: AuditInput): Promise<string> {
      const id = randomUUID();
      await db.auditEvent.create({
        data: {
          id,
          at: e.at,
          userId: e.userId,
          action: e.action,
          targetSystem: e.system,
          targetObject: e.object,
          targetId: e.targetId ?? null,
          accountId: e.accountId ?? null,
          intentId: e.intentId ?? null,
          confirmationJson: e.confirmation ? JSON.stringify(e.confirmation) : null,
          beforeJson: e.before === undefined ? null : JSON.stringify(e.before),
          afterJson: e.after === undefined ? null : JSON.stringify(e.after),
          requestId: e.requestId,
        },
      });
      return id;
    },
    async query(filter: { accountId?: string; userId?: string; limit?: number }): Promise<AuditEvent[]> {
      const rows = await db.auditEvent.findMany({
        where: { ...(filter.accountId ? { accountId: filter.accountId } : {}), ...(filter.userId ? { userId: filter.userId } : {}) },
        orderBy: { at: 'desc' },
        take: filter.limit ?? 200,
      });
      return rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        rmId: r.userId,
        action: r.action,
        target: { system: r.targetSystem as Source, object: r.targetObject, id: r.targetId ?? undefined },
        intentId: r.intentId ?? undefined,
        confirmation: r.confirmationJson ? JSON.parse(r.confirmationJson) : undefined,
        before: r.beforeJson ? JSON.parse(r.beforeJson) : undefined,
        after: r.afterJson ? JSON.parse(r.afterJson) : undefined,
        requestId: r.requestId,
      }));
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;
