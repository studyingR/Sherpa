/**
 * WriteGateway (docs/02 §4): the single choke point for writes to systems of record.
 * Services build a WriteIntent → the RM confirms → execute() validates (same RM, not expired, approvals)
 * and runs the registered executor. Every external write is audited (C-01, C-18). Idempotent on intent id.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '@sherpa/db';
import type {
  ApprovalItem,
  Confirmation,
  HeldItem,
  PlannedWrite,
  Source,
  WriteIntent,
  WriteIntentKind,
  WriteResult,
  WrittenItem,
} from '@sherpa/shared';
import type { Audit } from '../audit';
import type { UserContext } from '../auth/entitlements';
import type { Clock } from '../lib/clock';
import { AppError, conflict, notFound } from '../lib/errors';

export const INTENT_TTL_MS = 15 * 60 * 1000;

/** Passed to executors: every external write must go through `write()` so it is audited. */
export interface WriteSession {
  ctx: UserContext;
  intent: WriteIntent;
  confirmation: Confirmation;
  approved(approvalId: string): boolean;
  write<T>(target: { system: Source; object: string; action: string; accountId?: string | null; before?: unknown }, fn: () => Promise<T>, describe?: (r: T) => { targetId?: string; after?: unknown }): Promise<T>;
  /** Internal-only bookkeeping (Sherpa DB) — still audited for traceability. */
  note(action: string, accountId: string | null, after?: unknown): Promise<void>;
}

export interface ExecutorResult {
  written: WrittenItem[];
  held: HeldItem[];
  debriefId?: string;
  resultRef?: string;
}

export type Executor = (s: WriteSession, payload: unknown) => Promise<ExecutorResult>;

export function createWriteGateway(deps: { db: Db; audit: Audit; clock: Clock }) {
  const executors = new Map<WriteIntentKind, Executor>();

  function toIntent(r: Awaited<ReturnType<Db['writeIntent']['findUnique']>> & object): WriteIntent {
    return {
      id: r.id,
      rmId: r.userId,
      kind: r.kind as WriteIntentKind,
      payload: JSON.parse(r.payloadJson),
      summary: r.summary,
      planned: JSON.parse(r.plannedJson) as PlannedWrite[],
      requiresApproval: JSON.parse(r.approvalsRequiredJson) as ApprovalItem[],
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    };
  }

  return {
    register(kind: WriteIntentKind, ex: Executor) {
      executors.set(kind, ex);
    },

    async createIntent(
      ctx: UserContext,
      kind: WriteIntentKind,
      payload: unknown,
      opts: { summary: string; planned: PlannedWrite[]; approvals?: ApprovalItem[] },
    ): Promise<WriteIntent> {
      const now = deps.clock.now();
      const row = await deps.db.writeIntent.create({
        data: {
          id: randomUUID(),
          userId: ctx.rmId,
          kind,
          payloadJson: JSON.stringify(payload),
          approvalsRequiredJson: JSON.stringify(opts.approvals ?? []),
          plannedJson: JSON.stringify(opts.planned),
          summary: opts.summary,
          status: 'PENDING',
          createdAt: now,
          expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
        },
      });
      return toIntent(row);
    },

    async getIntent(ctx: UserContext, id: string): Promise<WriteIntent> {
      const r = await deps.db.writeIntent.findUnique({ where: { id } });
      if (!r || r.userId !== ctx.rmId) throw notFound('That confirmation request');
      return toIntent(r);
    },

    async execute(ctx: UserContext, confirmation: Confirmation): Promise<WriteResult> {
      const row = await deps.db.writeIntent.findUnique({ where: { id: confirmation.intentId } });
      if (!row) throw notFound('That confirmation request');
      // C-01: confirmation must come from the same RM who prepared the intent.
      if (row.userId !== ctx.rmId || (confirmation.confirmedBy && confirmation.confirmedBy !== ctx.rmId)) {
        throw new AppError('FORBIDDEN', 'Only the RM who prepared this can confirm it.');
      }
      if (row.status === 'EXECUTED' && row.resultJson) return JSON.parse(row.resultJson) as WriteResult; // idempotent
      if (row.status !== 'PENDING') throw conflict('This request was already handled.');
      const now = deps.clock.now();
      if (row.expiresAt.getTime() < now.getTime()) {
        await deps.db.writeIntent.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        throw conflict('This confirmation expired. Review the changes and confirm again.', { code: 'INTENT_EXPIRED' });
      }
      const intent = toIntent(row);
      const executor = executors.get(intent.kind);
      if (!executor) throw new AppError('INTERNAL', `No executor for ${intent.kind}`);

      // Claim the intent before executing so a double-tap can't run it twice.
      const claimed = await deps.db.writeIntent.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'EXECUTING' } });
      if (claimed.count !== 1) throw conflict('This request is already being saved.');

      const confirmationAudit = { channel: confirmation.channel, utterance: confirmation.utterance };
      const session: WriteSession = {
        ctx,
        intent,
        confirmation,
        approved: (id) => confirmation.approvals[id] === true,
        async write(target, fn, describe) {
          const result = await fn();
          const d = describe?.(result) ?? {};
          await deps.audit.record({
            userId: ctx.rmId,
            action: target.action,
            system: target.system,
            object: target.object,
            targetId: d.targetId,
            accountId: target.accountId ?? null,
            intentId: intent.id,
            confirmation: confirmationAudit,
            before: target.before,
            after: d.after,
            requestId: ctx.requestId,
            at: deps.clock.now(),
          });
          return result;
        },
        async note(action, accountId, after) {
          await deps.audit.record({
            userId: ctx.rmId, action, system: 'SHERPA', object: 'Sherpa', accountId, intentId: intent.id,
            confirmation: confirmationAudit, after, requestId: ctx.requestId, at: deps.clock.now(),
          });
        },
      };

      try {
        const r = await executor(session, intent.payload);
        const result: WriteResult = { intentId: intent.id, debriefId: r.debriefId, written: r.written, held: r.held, resultRef: r.resultRef };
        await deps.db.writeIntent.update({ where: { id: row.id }, data: { status: 'EXECUTED', resultJson: JSON.stringify(result) } });
        return result;
      } catch (err) {
        await deps.db.writeIntent.update({ where: { id: row.id }, data: { status: 'FAILED' } });
        throw err;
      }
    },
  };
}
export type WriteGateway = ReturnType<typeof createWriteGateway>;
