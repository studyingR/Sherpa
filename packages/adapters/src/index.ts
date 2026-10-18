import type { Db } from '@sherpa/db';
import type { Adapters } from './interfaces';
import { createMockAdapters } from './mock';
import { createLiveAdapters, type LiveConfig } from './live';

export * from './interfaces';
export * from './llm';
export * from './voice';
export { createMockAdapters, setMockFailure, hashPin } from './mock';
export { createLiveAdapters, LIVE_REQUIRED_ENV, type LiveConfig } from './live';

export interface AdapterFactoryConfig {
  mode: 'mock' | 'live';
  db: Db;
  now: () => Date;
  live?: LiveConfig;
}

/** Factory: getAdapters(config) (docs/02 §2). */
export function getAdapters(cfg: AdapterFactoryConfig): Adapters {
  if (cfg.mode === 'live') {
    if (!cfg.live) throw new Error('INTEGRATIONS_MODE=live requires live adapter configuration.');
    return createLiveAdapters(cfg.live, cfg.db, cfg.now);
  }
  return createMockAdapters({ db: cfg.db, now: cfg.now });
}
