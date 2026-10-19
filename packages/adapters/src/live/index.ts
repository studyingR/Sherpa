/**
 * Live adapter skeletons (M9). Each throws NotImplemented until wired to sandboxes.
 * Switching INTEGRATIONS_MODE=live without credentials fails fast at startup (see LIVE_REQUIRED_ENV).
 */
import type { Db } from '@sherpa/db';
import type { Adapters } from '../interfaces';
import { createMockAdapters } from '../mock';
import { createLiveSalesforce } from './salesforce';
import { createLiveGraph } from './graph';
import { createLiveLending } from './lending';

export interface LiveConfig {
  salesforce: { instanceUrl: string; accessToken: string; apiVersion: string };
  graph: { tenantId: string; accessToken: string };
  ncino: { baseUrl: string; apiKey: string };
  acbs: { baseUrl: string; apiKey: string };
  coreDeposits: { baseUrl: string; apiKey: string };
  precisionLender: { baseUrl: string; apiKey: string };
  fetchImpl?: typeof fetch;
}

export const LIVE_REQUIRED_ENV = [
  'SF_INSTANCE_URL',
  'SF_ACCESS_TOKEN',
  'GRAPH_TENANT_ID',
  'GRAPH_ACCESS_TOKEN',
  'NCINO_BASE_URL',
  'NCINO_API_KEY',
  'ACBS_BASE_URL',
  'ACBS_API_KEY',
  'CORE_DEPOSITS_BASE_URL',
  'CORE_DEPOSITS_API_KEY',
  'PRECISION_LENDER_BASE_URL',
  'PRECISION_LENDER_API_KEY',
] as const;

export function createLiveAdapters(cfg: LiveConfig, db: Db, now: () => Date): Adapters {
  // Systems without a live implementation yet (identity, news, KYC, push, archive, telephony, events)
  // keep their mock behavior so the app stays usable against partial sandboxes.
  const fallback = createMockAdapters({ db, now });
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const graph = createLiveGraph(cfg.graph, fetchImpl);
  const lending = createLiveLending(cfg, fetchImpl);
  return {
    ...fallback,
    salesforce: createLiveSalesforce(cfg.salesforce, fetchImpl),
    calendar: graph.calendar,
    mail: graph.mail,
    ncino: lending.ncino,
    acbs: lending.acbs,
    deposits: lending.deposits,
    precisionLender: lending.precisionLender,
  };
}
