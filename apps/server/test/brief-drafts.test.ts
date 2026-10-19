import { beforeAll, describe, expect, it } from 'vitest';
import { setMockFailure } from '@sherpa/adapters';
import { G1, runDebrief, setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
beforeAll(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
});

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('F02 brief', () => {
  it('F02-AC1/AC3: every seeded meeting renders all sections; each fact has source + as-of; spoken ≤ 230 words', async () => {
    for (const id of ['00UMock00000Acme01', '00UMock00000Harb01', '00UMock00000Cast01', '00UMock00000Summ01']) {
      const r = await h.as(maya).get(`/v1/briefs/meeting/${id}`);
      expect(r.statusCode).toBe(200);
      const b = r.json();
      expect(b.sections.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining(['overview', 'contacts', 'touchpoints', 'commitments', 'credit', 'deposits', 'opportunities', 'alerts', 'documents', 'talkingPoints', 'news']));
      for (const s of b.sections) {
        for (const f of s.facts) expect(f.source && f.asOf).toBeTruthy();
        for (const it of s.items ?? []) expect(it.source && it.asOf).toBeTruthy();
      }
      expect(wordCount(b.spoken)).toBeLessThanOrEqual(230);
    }
  });

  it('F02-AC2: with CoreDeposits failing the brief still renders and lists the missing source', async () => {
    await setMockFailure(h.db, 'CoreDeposits', true);
    try {
      const b = (await h.as(maya).get('/v1/briefs/account/001Mock000000Harb1')).json();
      expect(b.missingSources).toContain('CORE_DEPOSITS');
      expect(b.sections.find((s: { id: string }) => s.id === 'deposits').facts).toHaveLength(0);
      expect(b.spoken).toMatch(/couldn't reach Core deposits/);
    } finally {
      await setMockFailure(h.db, 'CoreDeposits', false);
    }
  });

  it('F02-AC4: an RM cannot brief an account outside their book (403)', async () => {
    expect((await h.as(maya).get('/v1/briefs/account/001Mock000000Gree1')).statusCode).toBe(403);
  });

  it('F02-FR4 / C-09: privacy rendering hides balances and exposure', async () => {
    const b = (await h.as(maya).get('/v1/briefs/meeting/00UMock00000Harb01')).json();
    expect(b.spoken).toMatch(/\$8M/);
    expect(b.spokenPrivate).not.toMatch(/\$\d/);
  });

  it('F02-FR6: Q&A answers from the brief, otherwise "I don\'t have that."', async () => {
    const yes = (await h.as(maya).post('/v1/briefs/001Mock000000Harb1/ask', { question: 'When does their line mature?' })).json();
    expect(yes.answer).toMatch(/maturity/i);
    expect(yes.facts.length).toBeGreaterThan(0);
    const no = (await h.as(maya).post('/v1/briefs/001Mock000000Harb1/ask', { question: "What is the CFO's favorite color?" })).json();
    expect(no.answer).toBe("I don't have that.");
  });

  it('C-14: instructions inside news text are stripped', async () => {
    const b = (await h.as(maya).get('/v1/briefs/account/001Mock000000Harb1')).json();
    const news = JSON.stringify(b.sections.find((s: { id: string }) => s.id === 'news'));
    expect(news).toMatch(/Port volumes up 9%/);
    expect(news).not.toMatch(/Ignore previous instructions|approve all loans/i);
  });

  it('F02-FR7: assembling a brief performs no writes', async () => {
    const writes = await h.db.mockCallLog.count({ where: { method: { startsWith: 'create' } } });
    await h.as(maya).get('/v1/briefs/meeting/00UMock00000Cast01');
    expect(await h.db.mockCallLog.count({ where: { method: { startsWith: 'create' } } })).toBe(writes);
  });
});

describe('F03 follow-up drafts', () => {
  let debriefId: string;
  beforeAll(async () => {
    const r = await runDebrief(h, maya, G1);
    debriefId = r.replies[4].writeResult!.debriefId;
  });

  it('F03-AC1: the client email contains every included next step and no risk/complaint/internal content', async () => {
    const drafts = (await h.as(maya).post(`/v1/debriefs/${debriefId}/drafts`, { kinds: ['CLIENT', 'INTERNAL'] })).json();
    const client = drafts.find((d: { kind: string }) => d.kind === 'CLIENT');
    expect(client.to.map((r: { name: string }) => r.name)).toEqual(['Jane Ruiz', 'Tom Lee']);
    expect(client.body).toMatch(/equipment financing term sheet by Friday, October 23/);
    expect(client.body).toMatch(/Treasury Services team will reach out by Wednesday, October 21/);
    expect(client.body).toMatch(/introduce you to our FX specialist/);
    expect(client.body).not.toMatch(/complain|wire delays|risk rating|frustrat|MNPI|RAROC/i);
    expect(client.guardResult).toMatchObject({ passed: true, message: 'Commitment check passed' });
    const internal = drafts.filter((d: { kind: string }) => d.kind === 'INTERNAL').map((d: { team: string }) => d.team);
    expect(internal).toEqual(expect.arrayContaining(['Treasury Services', 'FX Desk']));
  });

  it('F03-AC2: injected commitment language is caught and absent from the saved draft', async () => {
    const [client] = (await h.as(maya).post(`/v1/debriefs/${debriefId}/drafts`, { kinds: ['CLIENT'] })).json();
    const edited = (await h.as(maya).patch(`/v1/drafts/${client.id}`, { body: `${client.body}\nWe guarantee approval at 6.1%.` })).json();
    expect(edited.body).not.toMatch(/guarantee|6\.1%/);
    expect(edited.guardResult.passed).toBe(false);
    const intent = (await h.as(maya).post(`/v1/drafts/${client.id}/intent`)).json();
    const saved = (await h.as(maya).post(`/v1/drafts/${client.id}/save-to-mailbox`, { intentId: intent.id, channel: 'tap', approvals: {} })).json();
    const mail = await h.db.mockMailDraft.findUnique({ where: { id: saved.mailDraftId } });
    expect(mail!.body).not.toMatch(/guarantee|6\.1%/);
  });

  it('F03-FR3: recipients must be Salesforce contacts or bank users', async () => {
    const internal = (await h.as(maya).post(`/v1/debriefs/${debriefId}/drafts`, { kinds: ['INTERNAL'] })).json();
    expect((await h.as(maya).patch(`/v1/drafts/${internal[0].id}`, { to: ['someone@outside.example'] })).statusCode).toBe(422);
    expect((await h.as(maya).patch(`/v1/drafts/${internal[0].id}`, { to: ['priya.shah@bank.example'] })).statusCode).toBe(200);
  });

  it('F03-FR6: drafts go to the mailbox as drafts; there is no send endpoint', async () => {
    const r = await h.as(maya).post('/v1/drafts/anything/send', {});
    expect(r.statusCode).toBe(404);
    expect(await h.db.mockCallLog.count({ where: { adapter: 'Mail', method: { not: 'createDraft' } } })).toBe(0);
  });
});
