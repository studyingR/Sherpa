import { z } from 'zod';
import { LIVE_REQUIRED_ENV } from '@sherpa/adapters';

const Env = z
  .object({
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default('0.0.0.0'),
    JWT_SECRET: z.string().min(8).default('dev-only-change-me'),
    DATABASE_URL: z.string().default('file:./dev.db'),
    SEED_TODAY: z.string().optional(),
    FEATURE_FLAGS_FILE: z.string().default('./config/features.json'),
    REFERRAL_ROUTING_FILE: z.string().default('./config/referral-routing.json'),
    LLM_MODE: z.enum(['mock', 'openai']).default('mock'),
    VOICE_MODE: z.enum(['mock', 'openai']).default('mock'),
    VOICE_PIPELINE: z.enum(['stt-tts', 'realtime']).default('stt-tts'),
    INTEGRATIONS_MODE: z.enum(['mock', 'live']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_TRANSCRIBE_MODEL: z.string().optional(),
    OPENAI_TTS_MODEL: z.string().optional(),
    OPENAI_TTS_VOICE: z.string().optional(),
    OPENAI_REALTIME_MODEL: z.string().optional(),
    LLM_GATEWAY_BASE_URL: z.string().optional(),
    LLM_GATEWAY_HEADERS: z.string().optional(),
    LLM_TIMEOUT_MS: z.coerce.number().int().default(20000),
    /** demo: the clock starts at SEED_TODAY 15:30 local when the server boots; real: wall clock. */
    CLOCK_MODE: z.enum(['demo', 'real']).default('demo'),
    SCHEDULER: z.enum(['on', 'off']).default('on'),
    NODE_ENV: z.string().default('development'),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((e, ctx) => {
    const needsKey = e.LLM_MODE === 'openai' || e.VOICE_MODE === 'openai';
    if (needsKey && !e.OPENAI_API_KEY) ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'required when LLM_MODE or VOICE_MODE is openai' });
    if (e.LLM_MODE === 'openai' && !e.OPENAI_MODEL) ctx.addIssue({ code: 'custom', path: ['OPENAI_MODEL'], message: 'required when LLM_MODE=openai (model names are config, never hard-coded)' });
    if (e.VOICE_MODE === 'openai') {
      for (const k of ['OPENAI_TRANSCRIBE_MODEL', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE'] as const) {
        if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when VOICE_MODE=openai' });
      }
    }
    if (e.VOICE_PIPELINE === 'realtime' && !e.OPENAI_REALTIME_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['OPENAI_REALTIME_MODEL'], message: 'required when VOICE_PIPELINE=realtime' });
    }
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings from .env as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${msg}`);
  }
  const cfg = parsed.data;
  if (cfg.INTEGRATIONS_MODE === 'live') {
    const missing = LIVE_REQUIRED_ENV.filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`INTEGRATIONS_MODE=live needs credentials for every live system. Missing: ${missing.join(', ')}. Use INTEGRATIONS_MODE=mock for local development.`);
    }
  }
  return cfg;
}
