export const FLAG_NAMES = [
  'F01_DEBRIEF',
  'F02_BRIEF',
  'F03_DRAFTS',
  'F04_NUDGES',
  'F05_REFERRALS',
  'F06_WATCHLIST',
  'F07_DEAL_INTAKE',
  'F08_DOC_CHASE',
  'F09_TALKING_POINTS',
  'F10_COVERAGE',
  'F11_LIVE_LISTENING',
  'F12_PRICING_GUIDANCE',
  'F13_HEALTH_SCORE',
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];
export type ResolvedFlags = Record<FlagName, boolean>;

export interface FlagConfigEntry {
  enabled: boolean;
  complianceApproved?: boolean;
  modelValidated?: boolean;
  allPartyConsentStates?: string[];
}
export type FlagConfig = Record<FlagName, FlagConfigEntry>;

/** Keys inside a flag entry that act as gates: when present they must be `true`. */
const GATE_KEYS = ['complianceApproved', 'modelValidated'] as const;

/** A feature is active only if `enabled` and every gate key present is `true` (docs/02 §5). */
export function isFlagActive(entry: FlagConfigEntry | undefined): boolean {
  if (!entry || entry.enabled !== true) return false;
  return GATE_KEYS.every((k) => entry[k] === undefined || entry[k] === true);
}

export function resolveFlags(config: Partial<FlagConfig>): ResolvedFlags {
  return Object.fromEntries(FLAG_NAMES.map((n) => [n, isFlagActive(config[n])])) as ResolvedFlags;
}
