/** M9 contract tests: live adapters map recorded fixtures to Sherpa's shapes and call the right endpoints. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../interfaces';
import { createLiveSalesforce, buildDebriefComposite } from './salesforce';
import { createLiveGraph, mapGraphEvent, toGraphDraft } from './graph';
import { createLiveLending } from './lending';
import { NotImplementedError } from '../interfaces';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));
const ctx: RequestContext = { rmId: 'u_maya', role: 'RM', bookAccountIds: new Set(), teamRmIds: [], requestId: 'r1' };

function recorder(responses: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined, headers: init?.headers as Record<string, string> });
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('Salesforce live adapter', () => {
  const sf = fx('salesforce.json');
  const cfg = { instanceUrl: 'https://example.my.salesforce.com', accessToken: 'test-token', apiVersion: 'v62.0' };

  it('maps Account, Contact and Task records', async () => {
    const { calls, fetchImpl } = recorder({ '/sobjects/Account/': sf.account, 'FROM+Contact': sf.contacts, 'FROM%20Contact': sf.contacts, 'FROM%20Task': sf.tasks });
    const a = createLiveSalesforce(cfg, fetchImpl);
    expect(await a.getAccount(ctx, '001Live000000Acme1')).toMatchObject({ id: '001Live000000Acme1', segment: 'COMMERCIAL', coverageTier: 'A', city: 'Newark' });
    expect(await a.getContacts(ctx, '001Live000000Acme1')).toEqual([{ id: '003Live00000Jane1', accountId: '001Live000000Acme1', name: 'Jane Ruiz', title: 'CFO', email: 'jane.ruiz@acme-mfg.example', phone: undefined, isPrimary: true }]);
    const tasks = await a.getTasks(ctx, { bookRmIds: ['005Live00000Maya1'] });
    expect(tasks[0]).toMatchObject({ subject: 'Send term sheet', status: 'OPEN', clientCommitment: true, accountName: 'Acme Manufacturing' });
    expect(calls[0].headers.Authorization).toBe('Bearer test-token');
    expect(calls[0].url).toBe('https://example.my.salesforce.com/services/data/v62.0/sobjects/Account/001Live000000Acme1');
  });

  it('creates the debrief through the composite API (all or none)', async () => {
    const { calls, fetchImpl } = recorder({ '/composite': sf.composite });
    const a = createLiveSalesforce(cfg, fetchImpl);
    expect(await a.createDebrief(ctx, { Account__c: '001Live000000Acme1' })).toEqual({ id: 'a0DLive00000Deb01' });
    const body = JSON.parse(calls[0].body!);
    expect(body.allOrNone).toBe(true);
    expect(body.compositeRequest[0]).toMatchObject({ method: 'POST', url: '/services/data/v62.0/sobjects/Meeting_Debrief__c' });
    const comp = buildDebriefComposite('v62.0', {}, [{ contactId: 'C1' }]);
    expect(comp.compositeRequest[1].body).toMatchObject({ Debrief__c: '@{debrief.id}', Contact__c: 'C1' });
  });

  it('methods not wired yet fail loudly instead of silently', async () => {
    const a = createLiveSalesforce(cfg, recorder({}).fetchImpl);
    await expect(a.createTasks(ctx, [])).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('Microsoft Graph live adapter', () => {
  it('maps calendar events and marks external attendees', () => {
    const m = mapGraphEvent(fx('graph-event.json'), 'bank.example');
    expect(m).toMatchObject({ id: 'AAMkEvent1', accountId: '001Live000000Acme1', type: 'IN_PERSON', start: '2026-10-19T18:00:00.000Z' });
    expect(m.attendees.map((a) => a.external)).toEqual([false, true]);
  });

  it('C-07: mail creates a draft via POST /me/messages and never calls /send', async () => {
    const { calls, fetchImpl } = recorder({ '/me/messages': { id: 'AAMkDraft1' } });
    const g = createLiveGraph({ tenantId: 't', accessToken: 'x' }, fetchImpl);
    expect(await g.mail.createDraft(ctx, { to: [{ name: 'Jane', email: 'jane@x.example' }], cc: [], subject: 'Hi', body: 'Body' })).toEqual({ id: 'AAMkDraft1' });
    expect(calls.map((c) => c.url)).toEqual(['https://graph.microsoft.com/v1.0/me/messages']);
    expect(calls.some((c) => /\/send\b/.test(c.url))).toBe(false);
    expect(toGraphDraft({ to: [], cc: [], subject: 's', body: 'b' }).body).toEqual({ contentType: 'Text', content: 'b' });
  });
});

describe('Lending live adapters', () => {
  it('maps nCino loans; draft requests go to the drafts endpoint only', async () => {
    const { calls, fetchImpl } = recorder({ '/loans': fx('ncino-loans.json'), '/credit-requests/drafts': { requestId: 'CR-1', status: 'Draft — RM review' } });
    const cfg = { ncino: { baseUrl: 'https://ncino.example', apiKey: 'k' }, acbs: { baseUrl: 'https://acbs.example', apiKey: 'k' }, coreDeposits: { baseUrl: 'https://dep.example', apiKey: 'k' }, precisionLender: { baseUrl: 'https://pl.example', apiKey: 'k' }, salesforce: { instanceUrl: '', accessToken: '', apiVersion: '' }, graph: { tenantId: '', accessToken: '' } };
    const l = createLiveLending(cfg, fetchImpl);
    expect(await l.ncino.getLoans(ctx, '001Live000000Acme1')).toEqual([expect.objectContaining({ id: 'LN-0001', commitment: 5_000_000, riskRating: 4, renewalOppOpen: false })]);
    expect(await l.ncino.createDraftRequest(ctx, { accountId: 'A' })).toEqual({ id: 'CR-1', status: 'Draft — RM review' });
    expect(calls.some((c) => /submit/i.test(c.url))).toBe(false);
  });
});
