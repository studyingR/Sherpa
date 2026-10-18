import { beforeEach, describe, expect, it } from 'vitest';
import { runTick } from '../src/jobs/scheduler';
import { inQuietHours } from '../src/services/compliance';
import { DEFAULT_PREFERENCES } from '@sherpa/shared';
import { setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeEach(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
});

describe('F04 Today, tasks and nudges', () => {
  it('F04-AC3: a commitment due today is at the top of the Today list', async () => {
    const v = (await h.as(maya).get('/v1/today')).json();
    expect(v.commitmentsDue[0]).toMatchObject({ subject: 'Send renewal documents to Ellen Ward', dueDate: '2026-10-19', clientCommitment: true });
  });

  it('F04-AC1: "mark done" updates the task through WriteGateway only after confirmation', async () => {
    const intent = (await h.as(maya).post('/v1/tasks/00TMockTask000001/intent', { action: 'COMPLETE' })).json();
    expect((await h.db.mockSfTask.findUnique({ where: { id: '00TMockTask000001' } }))!.status).toBe('OPEN');
    const r = (await h.as(maya).post('/v1/tasks/confirm', { intentId: intent.id, channel: 'tap', approvals: {} })).json();
    expect(r.written[0].label).toMatch(/Marked done/);
    expect((await h.db.mockSfTask.findUnique({ where: { id: '00TMockTask000001' } }))!.status).toBe('COMPLETED');
    expect(await h.db.auditEvent.count({ where: { intentId: intent.id } })).toBe(1);
    const v = (await h.as(maya).get('/v1/today')).json();
    expect(v.commitmentsDue.map((t: { id: string }) => t.id)).not.toContain('00TMockTask000001');
  });

  it('F04-FR2: voice-style commands route to intents (mark done, push, delegate)', async () => {
    const done = (await h.as(maya).post('/v1/ask', { text: 'mark the Brightwater docs done' })).json();
    expect(done.intent.summary).toMatch(/Send renewal documents to Ellen Ward/);
    const push = (await h.as(maya).post('/v1/ask', { text: 'push Castell to Thursday' })).json();
    expect(push.intent.kind).toBe('task.update');
    const del = (await h.as(maya).post('/v1/ask', { text: 'delegate the Acme treasury fee schedule to Priya' })).json();
    expect(del.intent).toMatchObject({ kind: 'task.delegate', requiresApproval: [expect.objectContaining({ kind: 'TASK_DELEGATE' })] });
  });

  it('delegation without its approval item is held', async () => {
    const intent = (await h.as(maya).post('/v1/tasks/00TMockTask000005/intent', { action: 'DELEGATE', delegateTo: 'u_priya' })).json();
    const r = (await h.as(maya).post('/v1/tasks/confirm', { intentId: intent.id, channel: 'tap', approvals: {} })).json();
    expect(r.held[0].reason).toBe('Held · not approved');
  });

  it('F04-FR5: the spoken agenda stays under 60 seconds (150 words)', async () => {
    const a = (await h.as(maya).get('/v1/agenda')).json();
    expect(a.spoken.split(/\s+/).length).toBeLessThanOrEqual(150);
    expect(a.spoken).toMatch(/Acme Manufacturing debrief is still pending/);
  });

  it('F04-AC2: quiet hours suppress pushes but the item appears in-app', async () => {
    expect(inQuietHours(DEFAULT_PREFERENCES, new Date(2026, 9, 19, 21, 0))).toBe(true);
    expect(inQuietHours(DEFAULT_PREFERENCES, new Date(2026, 9, 19, 12, 0))).toBe(false);
    h.clock.set(new Date(2026, 9, 19, 21, 0));
    const n = await h.services.notifications.notify('u_maya', { type: 'nudge', title: 'Test', body: 'Quiet', dedupeKey: 'q1' });
    expect(n).toMatchObject({ sentAt: null, suppressedReason: 'quiet hours' });
    const list = (await h.as(maya).get('/v1/notifications')).json();
    expect(list.some((x: { title: string }) => x.title === 'Test')).toBe(true);
    expect(await h.db.mockCallLog.count({ where: { adapter: 'Push' } })).toBe(0);
  });

  it('F04-FR4: duplicate nudges are suppressed within 24 hours', async () => {
    await h.services.notifications.notify('u_maya', { type: 'nudge', title: 'Once', body: 'x', dedupeKey: 'd1' });
    expect(await h.services.notifications.notify('u_maya', { type: 'nudge', title: 'Once', body: 'x', dedupeKey: 'd1' })).toBeNull();
  });

  it('F02-AC5: brief-ready push is scheduled 30 ± 1 min before seeded meetings', async () => {
    h.clock.set(new Date(2026, 9, 19, 15, 28)); // Harbor at 16:00 → 32 min away: too early
    await runTick(h.deps, h.services, h.clock.now());
    expect(await h.db.notification.count({ where: { dedupeKey: 'brief:00UMock00000Harb01' } })).toBe(0);
    h.clock.set(new Date(2026, 9, 19, 15, 30)); // 30 min before
    await runTick(h.deps, h.services, h.clock.now());
    const n = await h.db.notification.findFirst({ where: { dedupeKey: 'brief:00UMock00000Harb01' } });
    expect(n).toMatchObject({ title: 'Harbor Logistics brief is ready', deepLink: 'sherpa://brief/00UMock00000Harb01' });
    await runTick(h.deps, h.services, h.clock.now());
    expect(await h.db.notification.count({ where: { dedupeKey: 'brief:00UMock00000Harb01' } })).toBe(1);
  });

  it('F04-FR1: the morning agenda push fires at the RM’s configured time', async () => {
    h.clock.set(new Date(2026, 9, 20, 7, 45));
    await runTick(h.deps, h.services, h.clock.now());
    expect(await h.db.notification.count({ where: { userId: 'u_maya', type: 'agenda' } })).toBe(1);
  });
});
