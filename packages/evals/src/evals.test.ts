import { describe, expect, it } from 'vitest';
import { RuleModel } from '@sherpa/agent';
import { loadGolden, meetsTargets, runCase, score } from './score';

describe('extraction evals (mock mode)', () => {
  it('meets every target on the 20 golden debriefs; no case regresses', async () => {
    const cases = loadGolden();
    expect(cases).toHaveLength(20);
    const runs = [];
    for (const c of cases) runs.push(await runCase(c, new RuleModel()));
    const s = score(cases, runs);
    expect(meetsTargets(s.metrics)).toEqual({ ok: true, misses: [] });
    for (const p of s.perCase) expect(p.notes, p.id).toEqual([]);
  });
});
