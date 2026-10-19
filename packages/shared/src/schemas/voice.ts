import { z } from 'zod';
import { DebriefDraft, FlowState } from './debrief';
import { DealDraft } from './features';
import { Confirmation, WriteIntent, WriteResult } from './intents';
import { Mode } from './enums';
import { UiAction } from './views';

/** Microphone / speaker state shown on the call screen. */
export const VoiceState = z.enum(['CONNECTING', 'LISTENING', 'THINKING', 'SPEAKING', 'IDLE', 'ENDED']);
export type VoiceState = z.infer<typeof VoiceState>;

export const ClientMsg = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    mode: Mode,
    meetingId: z.string().optional(),
    accountId: z.string().optional(),
    resumeDraftId: z.string().optional(),
    audio: z.object({ format: z.literal('pcm16'), sampleRate: z.number() }),
  }),
  z.object({ type: z.literal('audio'), seq: z.number(), data: z.string() }),
  z.object({ type: z.literal('end_of_speech') }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('barge_in') }),
  z.object({ type: z.literal('confirm'), confirmation: Confirmation }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('pong') }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export type ServerMsg =
  | { type: 'session'; sessionId: string; draftId?: string; mode: z.infer<typeof Mode>; voiceMode: 'mock' | 'openai' }
  | { type: 'transcript'; speaker: 'RM' | 'AGENT'; text: string; final: boolean; kind?: string }
  | { type: 'agent_audio'; seq: number; data: string; format: 'pcm16' | 'mp3' }
  | { type: 'agent_audio_end' }
  | { type: 'draft_update'; draft: z.infer<typeof DebriefDraft> | z.infer<typeof DealDraft> }
  | { type: 'flag'; flag: 'COMPLAINT' | 'MNPI' | 'SENSITIVE'; message: string }
  | { type: 'intent'; intent: z.infer<typeof WriteIntent> }
  | { type: 'write_result'; result: z.infer<typeof WriteResult> }
  | { type: 'ui_action'; action: z.infer<typeof UiAction> }
  | { type: 'state'; state: VoiceState; flow?: z.infer<typeof FlowState> }
  | { type: 'ping' }
  | { type: 'error'; code: string; message: string };
