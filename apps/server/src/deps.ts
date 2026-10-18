import type { Adapters, VoiceProvider } from '@sherpa/adapters';
import type { AgentModel } from '@sherpa/agent';
import type { Db } from '@sherpa/db';
import type { Specialty } from '@sherpa/shared';
import type { Audit } from './audit';
import type { Config } from './config';
import type { FlagStore } from './flags';
import type { Clock } from './lib/clock';
import type { Logger } from './lib/logger';
import type { WriteGateway } from './write-gateway';

export interface RoutingRule {
  specialty: Specialty;
  region: string;
  segment: string;
  queue: string;
  userId?: string;
}
export interface RoutingConfig {
  defaultQueue: string;
  rules: RoutingRule[];
}

/** Everything services need, built once in buildApp(). */
export interface Deps {
  config: Config;
  db: Db;
  adapters: Adapters;
  model: AgentModel;
  voice: VoiceProvider;
  flags: FlagStore;
  clock: Clock;
  log: Logger;
  audit: Audit;
  gateway: WriteGateway;
  routing: RoutingConfig;
  /** Recorded on every debrief as Model_Version__c (C-18). */
  modelVersion: string;
}
