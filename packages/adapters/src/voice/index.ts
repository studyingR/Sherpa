import OpenAI, { toFile } from 'openai';

/** Speech-to-text + text-to-speech (docs/05 §2, stt-tts pipeline). Audio is never persisted (C-10). */
export interface VoiceProvider {
  readonly name: 'mock' | 'openai';
  /** Transcribe one utterance of PCM16 mono audio. */
  transcribe(pcm16: Buffer, sampleRate: number): Promise<string>;
  /** Returns MP3 bytes, or null when the client should speak the text itself (mock mode). */
  synthesize(text: string, opts?: { speed?: number }): Promise<Buffer | null>;
}

/** Mock: `text` messages are treated as speech; TTS is left to the device (expo-speech). */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock' as const;
  async transcribe(): Promise<string> {
    return '';
  }
  async synthesize(): Promise<Buffer | null> {
    return null;
  }
}

/** Wrap raw PCM16 mono samples in a WAV container, in memory only. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface OpenAiVoiceOptions {
  apiKey: string;
  transcribeModel: string;
  ttsModel: string;
  ttsVoice: string;
  timeoutMs: number;
}

export class OpenAiVoiceProvider implements VoiceProvider {
  readonly name = 'openai' as const;
  private client: OpenAI;
  constructor(private opts: OpenAiVoiceOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: 1 });
  }

  async transcribe(pcm16: Buffer, sampleRate: number): Promise<string> {
    if (pcm16.length < sampleRate * 2 * 0.25) return ''; // < 250 ms: nothing said
    const file = await toFile(pcm16ToWav(pcm16, sampleRate), 'utterance.wav', { type: 'audio/wav' });
    const res = await this.client.audio.transcriptions.create({ file, model: this.opts.transcribeModel, language: 'en' });
    return (res as { text: string }).text.trim();
  }

  async synthesize(text: string, opts?: { speed?: number }): Promise<Buffer | null> {
    const res = await this.client.audio.speech.create({
      model: this.opts.ttsModel,
      voice: this.opts.ttsVoice,
      input: text,
      response_format: 'mp3',
      ...(opts?.speed ? { speed: opts.speed } : {}),
    });
    return Buffer.from(await res.arrayBuffer());
  }
}
