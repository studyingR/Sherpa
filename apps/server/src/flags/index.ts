import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveFlags, type FlagConfig, type FlagName, type ResolvedFlags } from '@sherpa/shared';
import { AppError } from '../lib/errors';

export interface FlagStore {
  resolved: ResolvedFlags;
  config: Partial<FlagConfig>;
  isActive(flag: FlagName): boolean;
  /** Inactive features look like they don't exist: 404 (docs/02 §5, F11-AC1). */
  require(flag: FlagName): void;
}

export function createFlagStore(config: Partial<FlagConfig>): FlagStore {
  const resolved = resolveFlags(config);
  return {
    resolved,
    config,
    isActive: (f) => resolved[f],
    require(f) {
      if (!resolved[f]) throw new AppError('NOT_FOUND', 'Not found.');
    },
  };
}

export function loadFlagFile(path: string, repoRoot: string): Partial<FlagConfig> {
  const file = resolve(repoRoot, path);
  return JSON.parse(readFileSync(file, 'utf8')) as Partial<FlagConfig>;
}
