import { createDb, seed, type Db } from '@sherpa/db';
import type { FlagConfig } from '@sherpa/shared';
import { buildApp, primeAlerts } from '../src/app';
import { loadConfig } from '../src/config';
import { manualClock } from '../src/lib/clock';
import { createLogger } from '../src/lib/logger';

export const TODAY = new Date(2026, 9, 19); // Monday, SEED_TODAY in tests (docs/07)
export const NOW = new Date(2026, 9, 19, 15, 30);

export const ALL_FLAGS_ON: Partial<FlagConfig> = {
  F01_DEBRIEF: { enabled: true }, F02_BRIEF: { enabled: true }, F03_DRAFTS: { enabled: true }, F04_NUDGES: { enabled: true },
  F05_REFERRALS: { enabled: true }, F06_WATCHLIST: { enabled: true }, F07_DEAL_INTAKE: { enabled: true }, F08_DOC_CHASE: { enabled: true },
  F09_TALKING_POINTS: { enabled: true }, F10_COVERAGE: { enabled: true },
  F11_LIVE_LISTENING: { enabled: true, complianceApproved: true, allPartyConsentStates: ['CA', 'FL', 'IL', 'MD', 'MA', 'MT', 'NH', 'PA', 'WA'] },
  F12_PRICING_GUIDANCE: { enabled: true, complianceApproved: true },
  F13_HEALTH_SCORE: { enabled: true, complianceApproved: true, modelValidated: true },
};
export const DEFAULT_FLAGS: Partial<FlagConfig> = {
  ...ALL_FLAGS_ON,
  F11_LIVE_LISTENING: { enabled: false, complianceApproved: false, allPartyConsentStates: [] },
  F12_PRICING_GUIDANCE: { enabled: false, complianceApproved: false },
  F13_HEALTH_SCORE: { enabled: false, complianceApproved: false, modelValidated: false },
};

let sharedDb: Db | null = null;
export function testDb(): Db {
  sharedDb ??= createDb('file:./test.db');
  return sharedDb;
}

export async function setup(opts: { flags?: Partial<FlagConfig>; now?: Date; env?: Record<string, string> } = {}) {
  const db = testDb();
  await seed(db, TODAY);
  const clock = manualClock(opts.now ?? NOW);
  const config = loadConfig({
    NODE_ENV: 'test', LLM_MODE: 'mock', VOICE_MODE: 'mock', INTEGRATIONS_MODE: 'mock', SCHEDULER: 'off', LOG_LEVEL: 'silent',
    JWT_SECRET: 'test-secret-123', FEATURE_FLAGS_FILE: './config/features.json', REFERRAL_ROUTING_FILE: './config/referral-routing.json',
    ...opts.env,
  });
  const { app, deps, services } = await buildApp({ config, db, clock, flags: opts.flags ?? DEFAULT_FLAGS, logger: createLogger('silent') });
  await primeAlerts(deps, services);
  await app.ready();

  async function signIn(personaId: string): Promise<string> {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/sign-in', payload: { personaId } });
    return (r.json() as { token: string }).token;
  }
  function as(token: string) {
    const headers = { authorization: `Bearer ${token}` };
    return {
      get: (url: string) => app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload: unknown = {}) => app.inject({ method: 'POST', url, headers, payload: payload as object }),
      patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, headers, payload: payload as object }),
      put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object }),
    };
  }
  return { app, deps, services, db, clock, signIn, as };
}

export type Harness = Awaited<ReturnType<typeof setup>>;

/** Runs scripted chat turns through the debrief API. */
export async function runDebrief(h: Harness, token: string, turns: string[], start: Record<string, unknown> = { channel: 'CHAT' }) {
  const api = h.as(token);
  const s = (await api.post('/v1/debriefs/sessions', { ...start, startOver: true })).json() as { draftId: string; opening: string };
  const replies: { messages: { speaker: string; text: string }[]; actions: { type: string; debriefId?: string }[]; writeResult?: { held: { reason: string }[]; written: { kind: string }[]; debriefId: string } }[] = [];
  for (const text of turns) replies.push((await api.post(`/v1/debriefs/drafts/${s.draftId}/chat`, { text })).json());
  return { draftId: s.draftId, opening: s.opening, replies };
}

export const G1 = [
  "Yes, that's the one.",
  "Good meeting. They're expanding the Newark plant and need about two and a half million in equipment financing, probably Q1. Jane complained that wires were delayed twice this month. They're starting to buy from a German supplier, so FX came up. I said I'd send a term sheet by Friday.",
  'Treasury services should call Jane by Wednesday.',
  'Yes.',
  'Confirm.',
];
