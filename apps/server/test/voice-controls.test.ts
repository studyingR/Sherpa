import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { assertToolAllowed, ToolNotAllowedError } from '@sherpa/agent';
import { resolveFlags } from '@sherpa/shared';
import { createLogger } from '../src/lib/logger';
import { bufferedAudioBytes } from '../src/ws/voice';
import { DEFAULT_FLAGS, G1, setup, type Harness } from './helpers';

let h: Harness;
let maya: string;
let port: number;
beforeAll(async () => {
  h = await setup();
  maya = await h.signIn('u_maya');
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  port = (h.app.server.address() as { port: number }).port;
});
afterAll(async () => {
  await h.app.close();
});

function open(token = maya) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/voice?token=${token}`);
  const msgs: Record<string, unknown>[] = [];
  ws.on('message', (m) => msgs.push(JSON.parse(String(m))));
  const until = async (pred: (m: Record<string, unknown>) => boolean, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = msgs.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting; got ${JSON.stringify(msgs.map((x) => x.type))}`);
  };
  return { ws, msgs, until, ready: new Promise((r) => ws.on('open', r)) };
}

describe('M2 voice gateway (mock voice)', () => {
  it('runs the full G1 flow over the socket (text as speech) and saves on "confirm"', async () => {
    const c = open();
    await c.ready;
    // Sent immediately on open: must not be dropped while the server authenticates.
    c.ws.send(JSON.stringify({ type: 'start', mode: 'DEBRIEF', audio: { format: 'pcm16', sampleRate: 16000 } }));
    await c.until((m) => m.type === 'session');
    for (const t of G1) {
      const n = c.msgs.length;
      c.ws.send(JSON.stringify({ type: 'text', text: t }));
      await c.until((m) => c.msgs.indexOf(m) >= n && m.type === 'agent_audio_end');
    }
    const result = (await c.until((m) => m.type === 'write_result')) as { result: { written: { kind: string }[] } };
    expect(result.result.written.filter((w) => w.kind === 'task')).toHaveLength(3);
    expect(c.msgs.some((m) => m.type === 'flag' && m.flag === 'COMPLAINT')).toBe(true);
    c.ws.close();
  });

  it('M2: reconnecting with resumeDraftId resumes the same draft', async () => {
    const a = open();
    await a.ready;
    a.ws.send(JSON.stringify({ type: 'start', mode: 'DEBRIEF', meetingId: '00UMock00000Harb01', audio: { format: 'pcm16', sampleRate: 16000 } }));
    const session = (await a.until((m) => m.type === 'session')) as { draftId: string };
    a.ws.send(JSON.stringify({ type: 'text', text: 'Yes.' }));
    await a.until((m) => m.type === 'transcript' && m.text === 'Go ahead, tell me how it went.');
    a.ws.terminate();
    const b = open();
    await b.ready;
    b.ws.send(JSON.stringify({ type: 'start', mode: 'DEBRIEF', resumeDraftId: session.draftId, audio: { format: 'pcm16', sampleRate: 16000 } }));
    const t = (await b.until((m) => m.type === 'transcript' && String(m.text).startsWith('Picking up'))) as { text: string };
    expect(t.text).toMatch(/Go ahead, tell me how it went/);
    b.ws.close();
  });

  it('C-10: audio is buffered in memory only, discarded at end of speech, and never written to disk or DB', async () => {
    const before = readdirSync(tmpdir()).length;
    const c = open();
    await c.ready;
    c.ws.send(JSON.stringify({ type: 'start', mode: 'ASK', audio: { format: 'pcm16', sampleRate: 16000 } }));
    await c.until((m) => m.type === 'session');
    const chunk = Buffer.alloc(3200, 7).toString('base64'); // 100 ms
    for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ type: 'audio', seq: i, data: chunk }));
    await new Promise((r) => setTimeout(r, 100));
    expect(bufferedAudioBytes()).toBeGreaterThan(0);
    c.ws.send(JSON.stringify({ type: 'end_of_speech' }));
    await c.until((m) => m.type === 'error' && m.code === 'MOCK_VOICE');
    expect(bufferedAudioBytes()).toBe(0);
    expect(readdirSync(tmpdir()).filter((f) => /\.(wav|pcm|mp3|m4a)$/.test(f))).toHaveLength(0);
    expect(readdirSync(tmpdir()).length).toBeLessThanOrEqual(before + 1);
    // Schema-level: no table stores audio.
    const schema = readFileSync(resolve(__dirname, '../../../packages/db/prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/audio\w*\s+(Bytes|String)/i);
    c.ws.close();
  });

  it('rejects a socket without a valid token', async () => {
    const c = open('nope');
    await c.until((m) => m.type === 'error' && m.code === 'UNAUTHENTICATED');
  });
});

describe('controls', () => {
  it('C-07: no code path calls send on a mail adapter, and MailAdapter has no send method', () => {
    const root = resolve(__dirname, '../../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        if (['node_modules', '.expo', 'dist', '.turbo', 'test'].includes(f)) continue;
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts')) {
          const src = readFileSync(p, 'utf8');
          if (/\bmail\w*\.send\s*\(/i.test(src) || /mail\/send|messages\/[^'"]*\/send/i.test(src)) offenders.push(p);
        }
      }
    };
    for (const d of ['apps/server/src', 'apps/mobile/app', 'apps/mobile/src', 'packages']) walk(join(root, d));
    expect(offenders).toEqual([]);
    const iface = readFileSync(join(root, 'packages/adapters/src/interfaces/index.ts'), 'utf8');
    const mail = iface.slice(iface.indexOf('export interface MailAdapter'), iface.indexOf('}', iface.indexOf('export interface MailAdapter')));
    expect(mail).not.toMatch(/send/);
  });

  it('C-12: caller ID alone never authenticates the phone channel; PIN or push approval does', async () => {
    const base = { sessionId: 'CALL-1', userId: 'u_maya' };
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { ...base, callerId: '+19735550100' } })).json().ok).toBe(false);
    await h.as(maya).put('/v1/me/phone-pin', { pin: '482915' });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { ...base, pin: '000000' } })).json().ok).toBe(false);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { ...base, pin: '482915' } })).json().ok).toBe(true);
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { ...base, pushApproved: true } })).json().ok).toBe(true);
  });

  it('C-14: tools cannot be triggered by external content; inactive-feature tools are not registered', () => {
    const flags = resolveFlags(DEFAULT_FLAGS);
    expect(() => assertToolAllowed('prepare_task_action', 'ASK', flags, 'EXTERNAL')).toThrow(ToolNotAllowedError);
    expect(() => assertToolAllowed('get_pricing_guidance', 'ASK', flags, 'RM')).toThrow(ToolNotAllowedError);
    expect(assertToolAllowed('assemble_brief', 'ASK', flags, 'RM').name).toBe('assemble_brief');
  });

  it('C-19: transcripts, email bodies and contact details are redacted in logs', () => {
    const lines: string[] = [];
    const sink = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
    const log = createLogger('info', sink as never);
    log.info({ transcript: 'Jane complained', email: { body: 'secret body' }, contact: { email: 'jane@x.example' }, phone: '+1-973-555-0141', text: 'utterance' }, 'turn');
    const out = lines.join('');
    expect(out).not.toMatch(/Jane complained|secret body|jane@x\.example|555-0141|utterance/);
    expect(out).toMatch(/\[redacted\]/);
  });

  it('M8 telephony harness: a simulated inbound call is logged and runs through the same identity checks', async () => {
    const r = (await h.app.inject({ method: 'POST', url: '/v1/dev/telephony/inbound', payload: { callerId: '+19735550100' } })).json();
    expect(r.callId).toMatch(/^CALL-/);
    expect(await h.db.mockCallLog.count({ where: { adapter: 'Telephony' } })).toBe(1);
  });
});
