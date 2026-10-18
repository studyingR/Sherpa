/**
 * Voice session client (docs/04 §16). Mic → PCM16 16 kHz chunks over WebSocket; client VAD ends the
 * utterance after 2.5 s of silence (F01-FR2) or on "Done talking". Agent replies arrive as text (captions)
 * and MP3 audio (openai mode) or are spoken on-device (mock mode). Raw audio never touches disk (rule 5).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream, type AudioPlayer } from 'expo-audio';
import type { DealDraft, DebriefDraft, Mode, ServerMsg, UiAction, VoiceState, WriteIntent, WriteResult } from '@sherpa/shared';
import { api, wsBase } from '@/api/client';
import { useSession } from '@/store/session';

export interface Line {
  id: string;
  speaker: 'RM' | 'AGENT' | 'FLAG';
  text: string;
  kind?: string;
}

const TARGET_RATE = 16000;
const SILENCE_MS = 2500;
const SPEECH_RMS = 0.025;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return globalThis.btoa(bin);
}
function fromBase64(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Linear resample of mono PCM16 to 16 kHz when the hardware delivers another rate. */
function resample(input: Int16Array, from: number): Int16Array {
  if (from === TARGET_RATE) return input;
  const ratio = from / TARGET_RATE;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = Math.round(input[i0] + (input[i1] - input[i0]) * (x - i0));
  }
  return out;
}

export interface VoiceOptions {
  mode: Mode;
  draftId?: string;
  meetingId?: string;
  accountId?: string;
  /** Don't speak replies aloud (live listening; or the RM muted Sherpa). */
  silent?: boolean;
  onUiAction?: (a: UiAction) => void;
}

export function useVoiceSession(opts: VoiceOptions) {
  const token = useSession((s) => s.token);
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<VoiceState>('CONNECTING');
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState<DebriefDraft | DealDraft | null>(null);
  const [intent, setIntent] = useState<WriteIntent | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  const [voiceMode, setVoiceMode] = useState<'mock' | 'openai'>('mock');
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const level = useRef(new Animated.Value(0)).current;
  const seq = useRef(0);
  const heardSpeech = useRef(false);
  const lastVoiceAt = useRef(0);
  const ttsChunks = useRef<Uint8Array[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const reconnects = useRef(0);
  const closedByUser = useRef(false);
  const sessionDraftId = useRef<string | undefined>(opts.draftId);

  const send = useCallback((m: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  const push = useCallback(
    (l: Omit<Line, 'id'>) =>
      setLines((x) => {
        const last = x[x.length - 1];
        // A reconnect re-sends the opening line; don't show it twice in a row.
        if (last && last.speaker === l.speaker && last.text === l.text && l.speaker === 'AGENT') return x;
        return [...x, { ...l, id: `${Date.now()}-${x.length}` }];
      }),
    [],
  );

  // ---------------------------------------------------------------- playback
  const queue = useRef<Uint8Array[]>([]);
  const stopPlayback = useCallback(() => {
    queue.current = [];
    Speech.stop();
    try {
      player.current?.pause();
      player.current?.remove();
    } catch {
      // player already released
    }
    player.current = null;
  }, []);

  /** Agent clips play back to back; barge-in clears the queue. */
  const enqueue = useCallback((bytes: Uint8Array) => {
    queue.current.push(bytes);
    if (!player.current) playNextRef.current();
  }, []);
  const playNextRef = useRef<() => void>(() => undefined);

  const playMp3 = useCallback(async (bytes: Uint8Array) => {
    // Agent TTS only (never RM audio). Written to cache for the player and deleted after playback.
    const f = new File(Paths.cache, `sherpa-tts-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`);
    f.write(bytes);
    const p = createAudioPlayer({ uri: f.uri });
    player.current = p;
    p.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish) {
        try {
          f.delete();
        } catch {
          // already gone
        }
        p.remove();
        if (player.current === p) player.current = null;
        if (queue.current.length) playNextRef.current();
        else setState('LISTENING');
      }
    });
    p.play();
  }, []);
  playNextRef.current = () => {
    const next = queue.current.shift();
    if (!next) return;
    setState('SPEAKING');
    playMp3(next).catch(() => setState('LISTENING'));
  };

  // ---------------------------------------------------------------- mic stream
  const { stream } = useAudioStream({
    sampleRate: TARGET_RATE,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buf) => {
      const pcm = resample(new Int16Array(buf.data), buf.sampleRate);
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += (pcm[i] / 32768) ** 2;
      const rms = Math.sqrt(sum / Math.max(1, pcm.length));
      level.setValue(Math.min(1, rms * 8));
      const now = Date.now();
      if (rms > SPEECH_RMS) {
        heardSpeech.current = true;
        lastVoiceAt.current = now;
      }
      send({ type: 'audio', seq: seq.current++, data: toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) });
      // Client VAD: 2.5 s of silence after speech ends the utterance.
      if (heardSpeech.current && now - lastVoiceAt.current > SILENCE_MS) {
        heardSpeech.current = false;
        stopListening(true);
      }
    },
  });

  const startListening = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone access is off. You can type instead.');
      return;
    }
    stopPlayback();
    if (state === 'SPEAKING') send({ type: 'barge_in' });
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    heardSpeech.current = false;
    lastVoiceAt.current = Date.now();
    await stream.start();
    setListening(true);
    setState('LISTENING');
    AccessibilityInfo.announceForAccessibility('Listening');
  }, [stream, send, stopPlayback, state]);

  const stopListening = useCallback(
    (endOfSpeech: boolean) => {
      try {
        stream.stop();
      } catch {
        // not streaming
      }
      setListening(false);
      level.setValue(0);
      if (endOfSpeech) {
        send({ type: 'end_of_speech' });
        setState('THINKING');
      }
    },
    [stream, send, level],
  );

  // ---------------------------------------------------------------- socket
  const connect = useCallback(() => {
    if (!token) return;
    const sock = new WebSocket(`${wsBase()}/v1/voice?token=${encodeURIComponent(token)}`);
    ws.current = sock;
    sock.onopen = () => {
      setConnected(true);
      setError(null);
      reconnects.current = 0;
      const o = optsRef.current;
      sock.send(JSON.stringify({ type: 'start', mode: o.mode, meetingId: o.meetingId, accountId: o.accountId, resumeDraftId: sessionDraftId.current, audio: { format: 'pcm16', sampleRate: TARGET_RATE } }));
    };
    sock.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      switch (m.type) {
        case 'session':
          setVoiceMode(m.voiceMode);
          if (m.draftId) sessionDraftId.current = m.draftId;
          break;
        case 'transcript':
          if (m.speaker === 'AGENT') {
            if (m.text.startsWith('Picking up')) setLines((x) => x.filter((l) => !l.text.startsWith('Picking up')));
            push({ speaker: 'AGENT', text: m.text, kind: m.kind });
            ttsChunks.current = [];
          } else {
            // Recognized RM speech (typed text is already shown locally).
            setLines((x) => (x[x.length - 1]?.speaker === 'RM' && x[x.length - 1]?.text === m.text ? x : [...x, { id: `${Date.now()}-${x.length}`, speaker: 'RM', text: m.text }]));
          }
          break;
        case 'agent_audio':
          ttsChunks.current.push(fromBase64(m.data));
          break;
        case 'agent_audio_end': {
          const chunks = ttsChunks.current;
          ttsChunks.current = [];
          if (optsRef.current.silent) break;
          if (chunks.length) {
            const total = chunks.reduce((a, c) => a + c.length, 0);
            const all = new Uint8Array(total);
            let o = 0;
            for (const c of chunks) {
              all.set(c, o);
              o += c.length;
            }
            enqueue(all);
          }
          break;
        }
        case 'state':
          setState((prev) => (m.state === 'LISTENING' && prev === 'SPEAKING' && player.current ? prev : m.state));
          if (m.state === 'THINKING') AccessibilityInfo.announceForAccessibility('Thinking');
          break;
        case 'draft_update':
          setDraft(m.draft);
          break;
        case 'flag':
          push({ speaker: 'FLAG', text: m.message, kind: m.flag });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          break;
        case 'intent':
          setIntent(m.intent);
          break;
        case 'write_result':
          setResult(m.result);
          break;
        case 'ui_action':
          optsRef.current.onUiAction?.(m.action);
          break;
        case 'ping':
          sock.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'error':
          if (m.code === 'MOCK_VOICE') setError(m.message);
          else setError(m.message);
          setState('LISTENING');
          break;
      }
    };
    sock.onclose = () => {
      setConnected(false);
      if (closedByUser.current) return;
      // Reconnect and resume the same draft (M2 acceptance: reconnect mid-call resumes).
      if (reconnects.current < 5) {
        reconnects.current += 1;
        setTimeout(connect, 800 * reconnects.current);
      } else {
        setError('Voice connection lost. Your draft is saved.');
      }
    };
  }, [token, push, enqueue]);

  // In mock voice mode the server sends text only; speak it on-device so the call still sounds like a call.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (voiceMode !== 'mock' || optsRef.current.silent) return;
    const last = lines[lines.length - 1];
    if (!last || last.speaker !== 'AGENT' || last.id === lastSpoken.current) return;
    lastSpoken.current = last.id;
    setState('SPEAKING');
    Speech.speak(last.text, { language: 'en-US', rate: 1.0, onDone: () => setState('LISTENING'), onStopped: () => setState('LISTENING') });
  }, [lines, voiceMode]);

  // A resumed debrief shows what was already said before the socket reconnects (F01-AC6).
  useEffect(() => {
    if (opts.mode !== 'DEBRIEF' || !opts.draftId) return;
    api<{ speaker: 'RM' | 'AGENT'; text: string; kind: string; id: string }[]>(`/debriefs/drafts/${opts.draftId}/transcript`)
      .then((prior) =>
        setLines((cur) => {
          const earlier: Line[] = prior
            .filter((l) => !l.text.startsWith('Picking up'))
            .map((l) => ({ id: l.id, speaker: l.kind === 'FLAG' ? 'FLAG' : l.speaker, text: l.text, kind: l.kind }));
          return [...earlier.filter((x) => !cur.some((y) => y.text === x.text && y.speaker === x.speaker)), ...cur];
        }),
      )
      .catch(() => undefined);
    // load once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    closedByUser.current = false;
    connect();
    return () => {
      closedByUser.current = true;
      stopPlayback();
      try {
        stream.stop();
      } catch {
        // not streaming
      }
      ws.current?.close();
    };
    // connect once per mounted session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      stopPlayback();
      if (listening) stopListening(false);
      push({ speaker: 'RM', text });
      send({ type: 'text', text });
      setState('THINKING');
    },
    [send, push, stopPlayback, listening, stopListening],
  );

  const end = useCallback(() => {
    closedByUser.current = true;
    stopPlayback();
    if (listening) stopListening(false);
    send({ type: 'stop' });
    ws.current?.close();
  }, [send, stopPlayback, listening, stopListening]);

  return {
    connected, state, lines, draft, intent, result, voiceMode, error, listening, level,
    draftId: sessionDraftId.current,
    startListening, stopListening, sendText, end, setError,
    confirm: (approvals: Record<string, boolean>, intentId: string) => send({ type: 'confirm', confirmation: { intentId, channel: 'voice', approvals } }),
  };
}
