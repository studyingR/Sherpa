import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  MockVoiceProvider,
  OpenAiLlmProvider,
  OpenAiVoiceProvider,
  UpstreamUnavailableError,
  getAdapters,
  type VoiceProvider,
} from '@sherpa/adapters';
import { LlmModel, PROMPT_VERSION, RuleModel, type AgentModel } from '@sherpa/agent';
import { createDb, type Db } from '@sherpa/db';
import type { FlagConfig } from '@sherpa/shared';
import { createAudit } from './audit';
import { authPlugin } from './auth/plugin';
import { loadConfig, type Config } from './config';
import type { Deps, RoutingConfig } from './deps';
import { createFlagStore, loadFlagFile } from './flags';
import { createClock, type Clock } from './lib/clock';
import { AppError } from './lib/errors';
import { createLogger, type Logger } from './lib/logger';
import { registerRoutes } from './routes';
import { createServices } from './services';
import { createWriteGateway } from './write-gateway';
import { registerVoiceGateway } from './ws/voice';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface BuildOptions {
  config?: Config;
  db?: Db;
  clock?: Clock;
  logger?: Logger;
  flags?: Partial<FlagConfig>;
  model?: AgentModel;
  voice?: VoiceProvider;
}

export async function buildApp(opts: BuildOptions = {}) {
  const config = opts.config ?? loadConfig();
  const log = opts.logger ?? createLogger(config.LOG_LEVEL);
  const db = opts.db ?? createDb();
  const clock = opts.clock ?? (await createClock(db, config.CLOCK_MODE, config.SEED_TODAY));
  const flags = createFlagStore(opts.flags ?? loadFlagFile(config.FEATURE_FLAGS_FILE, REPO_ROOT));
  const routing = JSON.parse(readFileSync(resolve(REPO_ROOT, config.REFERRAL_ROUTING_FILE), 'utf8')) as RoutingConfig;

  const adapters = getAdapters({ mode: config.INTEGRATIONS_MODE, db, now: () => clock.now() });
  const model: AgentModel =
    opts.model ??
    (config.LLM_MODE === 'openai'
      ? new LlmModel(
          new OpenAiLlmProvider({
            apiKey: config.OPENAI_API_KEY!,
            model: config.OPENAI_MODEL!,
            timeoutMs: config.LLM_TIMEOUT_MS,
            baseURL: config.LLM_GATEWAY_BASE_URL,
            defaultHeaders: config.LLM_GATEWAY_HEADERS ? (JSON.parse(config.LLM_GATEWAY_HEADERS) as Record<string, string>) : undefined,
          }),
          log,
        )
      : new RuleModel());
  const voice: VoiceProvider =
    opts.voice ??
    (config.VOICE_MODE === 'openai'
      ? new OpenAiVoiceProvider({ apiKey: config.OPENAI_API_KEY!, transcribeModel: config.OPENAI_TRANSCRIBE_MODEL!, ttsModel: config.OPENAI_TTS_MODEL!, ttsVoice: config.OPENAI_TTS_VOICE!, timeoutMs: config.LLM_TIMEOUT_MS })
      : new MockVoiceProvider());

  const audit = createAudit(db);
  const gateway = createWriteGateway({ db, audit, clock });
  const modelVersion = [
    `llm:${model.name}`,
    `stt:${config.VOICE_MODE === 'openai' ? config.OPENAI_TRANSCRIBE_MODEL : 'mock'}`,
    `tts:${config.VOICE_MODE === 'openai' ? config.OPENAI_TTS_MODEL : 'mock'}`,
    PROMPT_VERSION,
  ].join('|').slice(0, 80);
  const deps: Deps = { config, db, adapters, model, voice, flags, clock, log, audit, gateway, routing, modelVersion };
  const services = createServices(deps);

  // pino's Logger is wider than FastifyBaseLogger; the cast keeps plugin/route typing on the default instance.
  const app = Fastify({
    loggerInstance: log.child({}, {
      // C-19: the voice socket carries the session token in its URL; never log it.
      serializers: { req: (r: { method: string; url: string }) => ({ method: r.method, url: r.url.replace(/token=[^&]+/, 'token=[redacted]') }) },
    }),
    bodyLimit: 2 * 1024 * 1024,
  }) as unknown as FastifyInstance;
  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 512 * 1024 } });
  await app.register(authPlugin, { deps });

  app.setErrorHandler((err: FastifyError | AppError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    }
    if (err instanceof UpstreamUnavailableError) {
      return reply.status(503).send({ error: { code: 'UPSTREAM_UNAVAILABLE', message: `${err.system} isn't responding. Your work is saved.` } });
    }
    const fe = err as FastifyError;
    if (fe.validation || fe.statusCode === 400) {
      return reply.status(422).send({ error: { code: 'VALIDATION', message: 'Some fields need attention.' } });
    }
    req.log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again.' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));

  await registerRoutes(app, deps, services);
  await registerVoiceGateway(app, deps, services);

  return { app, deps, services };
}

/** Evaluate alerts on boot so a fresh seed shows the expected alert set immediately. */
export async function primeAlerts(deps: Deps, services: ReturnType<typeof createServices>) {
  if (!deps.flags.isActive('F06_WATCHLIST')) return;
  const { buildContext } = await import('./auth/entitlements');
  const rms = await deps.db.user.findMany({ where: { role: 'RM' } });
  for (const u of rms) {
    const ctx = await buildContext(deps.db, { id: u.id, name: u.name, email: u.email, role: 'RM', segment: u.segment as 'COMMERCIAL', region: u.region, teamId: u.teamId });
    await services.alerts.evaluateForRm(ctx, u.id);
  }
}
