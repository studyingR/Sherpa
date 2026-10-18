import { beforeEach, describe, expect, it } from 'vitest';
import { G1, runDebrief, setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeEach(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
});

const SF_WRITES = ['createDebrief', 'createAttendees', 'createTasks', 'updateTask', 'createOpportunity', 'updateOpportunity', 'upsertContact', 'updateEvent', 'createReferral', 'createComplaintCase'];
const sfWrites = (h: Harness) => h.db.mockCallLog.count({ where: { adapter: 'Salesforce', method: { in: SF_WRITES } } });

describe('F01 debrief (chat mode)', () => {
  it('F01-AC1/AC2 G1: no Salesforce write before confirm; confirm writes the golden record', async () => {
    const before = await runDebrief(h, maya, G1.slice(0, 4));
    expect(await sfWrites(h)).toBe(0); // F01-AC2
    const draft = (await h.as(maya).get(`/v1/debriefs/drafts/${before.draftId}`)).json();
    expect(draft.purpose).toBe('ANNUAL_REVIEW');
    expect(draft.attendees.filter((a: { external: boolean }) => a.external).map((a: { name: string; role: string }) => `${a.name} (${a.role})`)).toEqual(['Jane Ruiz (CFO)', 'Tom Lee (Controller)']);
    expect(draft.opportunities[0]).toMatchObject({ product: 'Equipment financing', amount: 2_500_000, closeQuarter: 'Q1 2027', approved: true });
    expect(draft.nextSteps.map((s: { title: string }) => s.title)).toEqual(['Send equipment financing term sheet', 'Call Jane about wire delays', 'Introduce FX specialist']);
    expect(draft.specialistInterest).toEqual(expect.arrayContaining(['FX', 'EQUIPMENT_FINANCE', 'TREASURY_MANAGEMENT']));
    expect(draft.flags.complaint.flagged).toBe(true);
    expect(draft.flags.mnpi.flagged).toBe(false);

    const confirm = (await h.as(maya).post(`/v1/debriefs/drafts/${before.draftId}/chat`, { text: 'Confirm.' })).json();
    expect(confirm.writeResult.written.filter((w: { kind: string }) => w.kind === 'task')).toHaveLength(3);
    expect(confirm.writeResult.written.some((w: { kind: string }) => w.kind === 'opportunity')).toBe(true);
    expect(confirm.writeResult.written.some((w: { kind: string }) => w.kind === 'complaint')).toBe(true);
    expect(await h.db.mockSfCase.count({ where: { recordType: 'Complaint', accountId: '001Mock000000Acme1' } })).toBe(1);
    expect(confirm.actions[0]).toMatchObject({ type: 'OPEN_SAVED' });
  });

  it('F01-AC3 G2: an unapproved opportunity is held, never created', async () => {
    const r = await runDebrief(h, maya, [...G1.slice(0, 3), 'Not yet, hold off.', 'Confirm.']);
    const result = r.replies[4].writeResult!;
    expect(result.held).toEqual([expect.objectContaining({ kind: 'opportunity', reason: 'Held · not approved' })]);
    expect(await h.db.mockSfOpportunity.count({ where: { accountId: '001Mock000000Acme1' } })).toBe(0);
  });

  it('F01-AC4: the complaint flag cannot be cleared via the API (409)', async () => {
    const r = await runDebrief(h, maya, G1.slice(0, 3));
    const res = await h.as(maya).patch(`/v1/debriefs/drafts/${r.draftId}`, { flags: { complaint: { flagged: false } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CONFLICT', details: { code: 'COMPLAINT_LOCKED' } } });
  });

  it('F01-AC5: excluded next steps do not create tasks (tap confirm)', async () => {
    const r = await runDebrief(h, maya, G1.slice(0, 4));
    const draft = (await h.as(maya).get(`/v1/debriefs/drafts/${r.draftId}`)).json();
    const fx = draft.nextSteps.find((s: { title: string }) => s.title === 'Introduce FX specialist');
    await h.as(maya).patch(`/v1/debriefs/drafts/${r.draftId}`, { nextSteps: [{ id: fx.id, include: false }] });
    const intent = (await h.as(maya).post(`/v1/debriefs/drafts/${r.draftId}/intent`)).json();
    const result = (await h.as(maya).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: { [`opp:${draft.opportunities[0].id}`]: true } })).json();
    expect(result.written.filter((w: { kind: string }) => w.kind === 'task')).toHaveLength(2);
    expect(await h.db.mockSfTask.count({ where: { subject: 'Introduce FX specialist' } })).toBe(0);
  });

  it('F01-AC6: a dropped session is offered for resume with prior content intact', async () => {
    const r = await runDebrief(h, maya, G1.slice(0, 2));
    const again = (await h.as(maya).post('/v1/debriefs/sessions', { channel: 'APP' })).json();
    expect(again.resumeOf).toMatchObject({ draftId: r.draftId, accountName: 'Acme Manufacturing' });
    const resumed = (await h.as(maya).post('/v1/debriefs/sessions', { channel: 'APP', resumeDraftId: r.draftId })).json();
    expect(resumed.draft.flags.complaint.flagged).toBe(true);
    expect(resumed.opening).toMatch(/Picking up your Acme Manufacturing debrief\. Who should follow up with Jane/);
  });

  it('F01-AC7: never more than 3 gap questions', async () => {
    const r = await runDebrief(h, maya, ['Yes.', 'They want maybe one point five for a new line. I need to send something. Priya should look at it.', 'skip', 'skip', 'skip', 'skip']);
    const draft = (await h.as(maya).get(`/v1/debriefs/drafts/${r.draftId}`)).json();
    expect(draft.gapQuestionsAsked).toBeLessThanOrEqual(3);
  });

  it('F01-FR1: naming another client re-proposes a meeting in the book', async () => {
    const r = await runDebrief(h, maya, ['No, it was Harbor.']);
    expect(r.replies[0].messages.at(-1)!.text).toMatch(/Harbor Logistics/);
  });

  it('C-01: confirmation must come from the same RM within 15 minutes', async () => {
    const r = await runDebrief(h, maya, G1.slice(0, 4));
    const intent = (await h.as(maya).post(`/v1/debriefs/drafts/${r.draftId}/intent`)).json();
    const devon = await h.signIn('u_devon');
    expect((await h.as(devon).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: {} })).statusCode).toBe(404);
    h.clock.advance(16 * 60_000);
    const late = await h.as(maya).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: {} });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.code).toBe('INTENT_EXPIRED');
    expect(await sfWrites(h)).toBe(0);
  });

  it('confirm is idempotent on intent id', async () => {
    const r = await runDebrief(h, maya, G1.slice(0, 4));
    const intent = (await h.as(maya).post(`/v1/debriefs/drafts/${r.draftId}/intent`)).json();
    const a = (await h.as(maya).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: {} })).json();
    const b = (await h.as(maya).post('/v1/debriefs/confirm', { intentId: intent.id, channel: 'tap', approvals: {} })).json();
    expect(b).toEqual(a);
    expect(await h.db.mockSfDebrief.count()).toBe(1);
  });

  it('C-18: every external write is audited and the debrief records Model_Version__c', async () => {
    await runDebrief(h, maya, G1);
    const writes = await sfWrites(h);
    const audited = await h.db.auditEvent.count({ where: { targetSystem: 'SALESFORCE', action: { not: 'log' } } });
    expect(audited).toBe(writes);
    const deb = await h.db.mockSfDebrief.findFirst();
    expect(JSON.parse(deb!.fieldsJson).Model_Version__c).toMatch(/sherpa-prompts-/);
    const audit = await h.db.auditEvent.findFirst({ where: { targetObject: 'Meeting_Debrief__c' } });
    expect(JSON.parse(audit!.confirmationJson!)).toMatchObject({ channel: 'voice', utterance: 'Confirm.' });
  });

  it('C-03/C-04: complaint and MNPI create compliance queue items', async () => {
    await runDebrief(h, maya, G1);
    await runDebrief(h, maya, ['Yes.', "Owen mentioned off the record they're in talks to acquire a competitor, nothing's public yet. I'll send the deck by Friday.", 'Just save it.'], { channel: 'CHAT', accountId: '001Mock000000Summ1' });
    const jordan = await h.signIn('u_jordan');
    const q = (await h.as(jordan).get('/v1/compliance/queue')).json() as { type: string }[];
    expect(q.map((i) => i.type).sort()).toEqual(['COMPLAINT', 'MNPI']);
    expect((await h.as(maya).get('/v1/compliance/queue')).statusCode).toBe(403);
  });

  it('C-05: sensitive details are left out of the summary unless kept (G8)', async () => {
    const r = await runDebrief(h, maya, ['Yes.', "She mentioned she's going on medical leave for surgery next month, so loop in Tom."]);
    const d = (await h.as(maya).get(`/v1/debriefs/drafts/${r.draftId}`)).json();
    expect(d.flags.sensitive).toMatchObject({ flagged: true, categories: ['health'] });
    expect(d.summary).not.toMatch(/surgery|medical/);
    expect(d.nextSteps.map((s: { title: string }) => s.title)).toContain('Loop in Tom');
  });
});
