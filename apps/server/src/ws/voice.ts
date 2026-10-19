/**
 * Voice WebSocket gateway (docs/04 §16, docs/05 §2 stt-tts pipeline).
 * Audio is buffered in memory per utterance, transcribed, and discarded immediately (rule 5, C-10).
 * Every agent reply is also sent as text (captions). Heartbeat every 15 s; clients resume with resumeDraftId.
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { maskFiguresForSpeech, PRIVACY_DECLINED, PRIVACY_PROMPT, isClearYes } from '@sherpa/agent';
import { ClientMsg, type AgentTurn, type Confirmation, type Mode, type ServerMsg, type VoiceState } from '@sherpa/shared';
import { contextFromToken } from '../auth/plugin';
import type { UserContext } from '../auth/entitlements';
import type { Deps } from '../deps';
import type { Services } from '../services';
import { readPrefs } from '../services/compliance';
import { AppError } from '../lib/errors';
import { metrics } from '../lib/http';

const HEARTBEAT_MS = 15_000;
const MAX_UTTERANCE_BYTES = 16_000 * 2 * 90; // 90 s of PCM16 @ 16 kHz
const TTS_CHUNK = 24 * 1024;

/** Live count of buffered audio bytes across sessions — tests assert it returns to 0 (C-10). */
export const audioBuffers = new Set<{ chunks: Buffer[] }>();
export function bufferedAudioBytes(): number {
  let n = 0;
  for (const b of audioBuffers) n += b.chunks.reduce((a, c) => a + c.length, 0);
  return n;
}

interface Session {
  ctx: UserContext;
  mode: Mode | null;
  draftId: string | null;
  dealId: string | null;
  liveSessionId: string | null;
  accountId: string | null;
  sampleRate: number;
  audio: { chunks: Buffer[] };
  speaking: { aborted: boolean } | null;
  privacy: boolean;
  figuresAllowed: boolean | null;
  pendingBrief: { spoken: string; spokenPrivate: string } | null;
  pendingIntentId: string | null;
  voiceSpeed: number;
}

export async function registerVoiceGateway(app: FastifyInstance, d: Deps, s: Services) {
  app.get('/v1/voice', { websocket: true }, async (socket: WebSocket, req) => {
    const send = (m: ServerMsg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    // Messages can arrive while we authenticate below; buffer them so a fast `start` is never dropped.
    const early: Buffer[] = [];
    let onMessage: ((raw: Buffer) => void) | null = null;
    socket.on('message', (raw: Buffer) => (onMessage ? onMessage(raw) : early.push(raw)));
    const token = (req.query as { token?: string }).token ?? '';
    let ctx: UserContext;
    try {
      ctx = await contextFromToken(d, app, token, req.id);
    } catch {
      send({ type: 'error', code: 'UNAUTHENTICATED', message: 'Sign in again to use voice.' });
      socket.close(4401, 'unauthenticated');
      return;
    }
    const user = await d.db.user.findUnique({ where: { id: ctx.rmId } });
    const prefs = readPrefs(user?.prefsJson ?? '{}');
    const sess: Session = {
      ctx, mode: null, draftId: null, dealId: null, liveSessionId: null, accountId: null, sampleRate: 16000,
      audio: { chunks: [] }, speaking: null, privacy: prefs.privacyMode, figuresAllowed: null, pendingBrief: null,
      pendingIntentId: null, voiceSpeed: prefs.voiceSpeed,
    };
    audioBuffers.add(sess.audio);

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      send({ type: 'ping' });
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('pong', () => (alive = true));

    const setState = (state: VoiceState) => send({ type: 'state', state });

    // Replies are spoken strictly in order, even when an early reply is still playing.
    let speechChain: Promise<void> = Promise.resolve();
    function speak(text: string, kind?: string): Promise<void> {
      speechChain = speechChain.then(() => speakNow(text, kind));
      return speechChain;
    }

    async function speakNow(text: string, kind?: string) {
      send({ type: 'transcript', speaker: 'AGENT', text, final: true, kind });
      setState('SPEAKING');
      const handle = { aborted: false };
      sess.speaking = handle;
      try {
        // Sentence by sentence, so the first audio starts while the rest is synthesized (docs/02 §9: ≤ 1.5 s).
        const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        let seq = 0;
        let next = sentences.length ? d.voice.synthesize(sentences[0], { speed: sess.voiceSpeed }) : Promise.resolve(null);
        for (let i = 0; i < sentences.length && !handle.aborted; i++) {
          const mp3 = await next;
          next = i + 1 < sentences.length ? d.voice.synthesize(sentences[i + 1], { speed: sess.voiceSpeed }) : Promise.resolve(null);
          if (!mp3 || handle.aborted) break;
          for (let j = 0; j < mp3.length && !handle.aborted; j += TTS_CHUNK) {
            send({ type: 'agent_audio', seq: seq++, data: mp3.subarray(j, j + TTS_CHUNK).toString('base64'), format: 'mp3' });
          }
          if (i < sentences.length - 1) send({ type: 'agent_audio_end' }); // one playable clip per sentence
        }
        await next.catch(() => null);
      } catch (err) {
        d.log.warn({ err: String(err) }, 'tts failed; caption only');
      } finally {
        send({ type: 'agent_audio_end' });
        sess.speaking = null;
        setState('LISTENING');
      }
    }

    async function relayTurn(turn: AgentTurn) {
      for (const f of turn.flags ?? []) send({ type: 'flag', flag: f.flag, message: f.message });
      if (turn.draft) send({ type: 'draft_update', draft: turn.draft });
      if (turn.intent) {
        sess.pendingIntentId = turn.writeResult ? null : turn.intent.id;
        send({ type: 'intent', intent: turn.intent });
      }
      if (turn.writeResult) send({ type: 'write_result', result: turn.writeResult });
      for (const a of turn.actions) send({ type: 'ui_action', action: a });
      const agentText = turn.messages.filter((m) => m.speaker === 'AGENT').map((m) => m.text).join(' ');
      if (agentText) await speak(agentText);
    }

    async function handleUtterance(text: string) {
      if (!text.trim()) {
        await speak("I didn't catch that. Could you say it again?");
        return;
      }
      send({ type: 'transcript', speaker: 'RM', text, final: true });
      setState('THINKING');
      metrics.inc('voice.turns');
      switch (sess.mode) {
        case 'DEBRIEF': {
          const turn = await s.debriefs.chat(sess.ctx, sess.draftId!, text, (early) => void speak(early));
          await relayTurn(turn);
          return;
        }
        case 'DEAL': {
          const r = await s.deals.turn(sess.ctx, sess.dealId!, text);
          send({ type: 'draft_update', draft: r.draft });
          if (r.writeResult) send({ type: 'write_result', result: r.writeResult });
          await speak(r.messages.filter((m) => m.speaker === 'AGENT').map((m) => m.text).join(' '));
          return;
        }
        case 'BRIEF': {
          if (sess.pendingBrief) {
            // F02-FR4: privacy check before reading figures aloud.
            sess.figuresAllowed = isClearYes(text);
            const b = sess.pendingBrief;
            sess.pendingBrief = null;
            await speak(sess.figuresAllowed ? b.spoken : `${b.spokenPrivate} ${PRIVACY_DECLINED}`);
            return;
          }
          const r = await s.brief.ask(sess.ctx, sess.accountId!, text);
          await speak(sess.privacy && !sess.figuresAllowed ? maskFiguresForSpeech(r.answer) : r.answer);
          return;
        }
        case 'LIVE': {
          // No spoken output during a client meeting (docs/05 §10).
          const r = await s.live.segment(sess.ctx, sess.liveSessionId!, text);
          for (const f of r.captured.flags) send({ type: 'flag', flag: f.flag, message: f.message });
          setState('LISTENING');
          return;
        }
        default: {
          // ASK and AGENDA: route the request; a spoken "confirm" executes a pending task intent.
          if (sess.pendingIntentId && /^(?:confirm|yes,? (?:save|confirm|do it)|save it)\b/i.test(text.trim())) {
            const result = await d.gateway.execute(sess.ctx, { intentId: sess.pendingIntentId, confirmedBy: sess.ctx.rmId, channel: 'voice', approvals: { delegate: true }, utterance: text });
            sess.pendingIntentId = null;
            send({ type: 'write_result', result });
            await speak(`Done. ${result.written.map((w) => w.label).join('. ')}.`);
            return;
          }
          const turn = await s.ask.handle(sess.ctx, { text, context: sess.accountId ? { accountId: sess.accountId } : undefined });
          if (turn.intent) turn.messages = [...turn.messages];
          await relayTurn({ ...turn, messages: turn.messages.map((m) => ({ ...m, text: sess.privacy ? maskFiguresForSpeech(m.text) : m.text })) });
        }
      }
    }

    async function start(m: Extract<ClientMsg, { type: 'start' }>) {
      sess.mode = m.mode;
      sess.sampleRate = m.audio.sampleRate || 16000;
      setState('CONNECTING');
      if (m.mode === 'DEBRIEF') {
        d.flags.require('F01_DEBRIEF');
        let draftId = m.resumeDraftId;
        let opening: string;
        if (!draftId) {
          const r = await s.debriefs.start(sess.ctx, { channel: 'APP', meetingId: m.meetingId, accountId: m.accountId });
          draftId = r.draftId;
          opening = r.opening;
        } else {
          const lines = await s.debriefs.transcriptFor(sess.ctx, draftId);
          const lastAgent = [...lines].reverse().find((l) => l.speaker === 'AGENT' && !l.text.startsWith('Picking up'));
          if (lines.length <= 1) opening = lastAgent?.text ?? '';
          else {
            const draft = await s.debriefs.getDraft(sess.ctx, draftId);
            // Spoken on reconnect only; not added to the transcript (a flaky network shouldn't litter the record).
            opening = `Picking up your ${draft.accountName} debrief. ${lastAgent?.text ?? ''}`.trim();
          }
        }
        sess.draftId = draftId;
        const draft = await s.debriefs.getDraft(sess.ctx, draftId);
        send({ type: 'session', sessionId: draft.sessionId, draftId, mode: 'DEBRIEF', voiceMode: d.config.VOICE_MODE });
        send({ type: 'draft_update', draft });
        await speak(opening);
        return;
      }
      if (m.mode === 'DEAL') {
        d.flags.require('F07_DEAL_INTAKE');
        if (m.resumeDraftId) {
          sess.dealId = m.resumeDraftId;
          const draft = await s.deals.get(sess.ctx, m.resumeDraftId);
          send({ type: 'session', sessionId: draft.id, draftId: draft.id, mode: 'DEAL', voiceMode: d.config.VOICE_MODE });
          send({ type: 'draft_update', draft });
          await speak(`Continuing the ${draft.accountName} deal.`);
        } else {
          if (!m.accountId) throw new AppError('VALIDATION', 'Pick the client for the deal.');
          const r = await s.deals.start(sess.ctx, m.accountId);
          sess.dealId = r.dealDraftId;
          send({ type: 'session', sessionId: r.sessionId, draftId: r.dealDraftId, mode: 'DEAL', voiceMode: d.config.VOICE_MODE });
          send({ type: 'draft_update', draft: r.draft });
          await speak(r.opening);
        }
        return;
      }
      if (m.mode === 'BRIEF') {
        d.flags.require('F02_BRIEF');
        const b = m.meetingId ? await s.brief.forMeeting(sess.ctx, m.meetingId) : await s.brief.assemble(sess.ctx, m.accountId ?? '', null);
        sess.accountId = b.accountId;
        send({ type: 'session', sessionId: req.id, mode: 'BRIEF', voiceMode: d.config.VOICE_MODE });
        if (sess.privacy) {
          sess.pendingBrief = { spoken: b.spoken, spokenPrivate: b.spokenPrivate };
          await speak(PRIVACY_PROMPT);
        } else {
          sess.figuresAllowed = true;
          await speak(b.spoken);
        }
        return;
      }
      if (m.mode === 'LIVE') {
        d.flags.require('F11_LIVE_LISTENING');
        if (!m.resumeDraftId) throw new AppError('CONSENT_REQUIRED', 'Start live listening from the consent screen.');
        sess.liveSessionId = m.resumeDraftId;
        send({ type: 'session', sessionId: m.resumeDraftId, mode: 'LIVE', voiceMode: d.config.VOICE_MODE });
        setState('LISTENING');
        return;
      }
      if (m.mode === 'AGENDA') {
        d.flags.require('F04_NUDGES');
        const a = await s.today.agenda(sess.ctx);
        send({ type: 'session', sessionId: req.id, mode: 'AGENDA', voiceMode: d.config.VOICE_MODE });
        await speak(sess.privacy ? maskFiguresForSpeech(a.spoken) : a.spoken);
        return;
      }
      // ASK
      sess.accountId = m.accountId ?? null;
      send({ type: 'session', sessionId: req.id, mode: 'ASK', voiceMode: d.config.VOICE_MODE });
      await speak('How can I help?');
    }

    async function endOfSpeech() {
      const pcm = Buffer.concat(sess.audio.chunks);
      sess.audio.chunks = []; // discard the raw audio immediately (C-10)
      if (!pcm.length) return;
      setState('THINKING');
      let text = '';
      try {
        text = await d.voice.transcribe(pcm, sess.sampleRate);
      } finally {
        pcm.fill(0);
      }
      if (d.voice.name === 'mock' && !text) {
        send({ type: 'error', code: 'MOCK_VOICE', message: 'Voice is in mock mode. Type your reply or use the suggested replies.' });
        setState('LISTENING');
        return;
      }
      await handleUtterance(text);
    }

    let queue = Promise.resolve();
    onMessage = (raw: Buffer) => {
      alive = true;
      let msg: ClientMsg;
      try {
        msg = ClientMsg.parse(JSON.parse(raw.toString()));
      } catch {
        send({ type: 'error', code: 'VALIDATION', message: 'Unrecognized message.' });
        return;
      }
      if (msg.type === 'audio') {
        const bytes = sess.audio.chunks.reduce((a, c) => a + c.length, 0);
        if (bytes < MAX_UTTERANCE_BYTES) sess.audio.chunks.push(Buffer.from(msg.data, 'base64'));
        return;
      }
      if (msg.type === 'barge_in') {
        if (sess.speaking) sess.speaking.aborted = true;
        setState('LISTENING');
        return;
      }
      if (msg.type === 'pong') return;
      // Everything else is processed in order.
      queue = queue.then(async () => {
        try {
          if (msg.type === 'start') await start(msg);
          else if (msg.type === 'end_of_speech') await endOfSpeech();
          else if (msg.type === 'text') await handleUtterance(msg.text);
          else if (msg.type === 'confirm') {
            const c: Confirmation = { ...msg.confirmation, confirmedBy: sess.ctx.rmId };
            const result = await d.gateway.execute(sess.ctx, c);
            sess.pendingIntentId = null;
            send({ type: 'write_result', result });
          } else if (msg.type === 'stop') {
            sess.audio.chunks = [];
            setState('ENDED');
            socket.close(1000, 'stopped');
          }
        } catch (err) {
          const e = err instanceof AppError ? err : null;
          d.log.warn({ err: String(err), mode: sess.mode }, 'voice turn failed');
          send({ type: 'error', code: e?.code ?? 'INTERNAL', message: e?.message ?? 'Something went wrong. Your draft is saved.' });
          setState('LISTENING');
        }
      });
    };
    for (const raw of early.splice(0)) onMessage(raw);

    socket.on('close', () => {
      clearInterval(heartbeat);
      sess.audio.chunks = [];
      audioBuffers.delete(sess.audio);
    });
  });
}
