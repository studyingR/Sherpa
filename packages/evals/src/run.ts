/**
 * pnpm evals [--mode mock|openai] [--case G1]
 * Writes packages/evals/reports/<timestamp>.md and exits non-zero if targets are missed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenAiLlmProvider } from '@sherpa/adapters';
import { LlmModel, RuleModel, type AgentModel } from '@sherpa/agent';
import { loadGolden, meetsTargets, report, runCase, score } from './score';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mode = arg('mode') ?? 'mock';
  let model: AgentModel;
  if (mode === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const name = process.env.OPENAI_MODEL;
    if (!apiKey || !name) throw new Error('openai mode needs OPENAI_API_KEY and OPENAI_MODEL in .env');
    model = new LlmModel(new OpenAiLlmProvider({ apiKey, model: name, timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 20000) }));
  } else {
    model = new RuleModel();
  }
  const cases = loadGolden(undefined, arg('case'));
  const runs = [];
  for (const c of cases) {
    process.stdout.write(`${c.id} `);
    runs.push(await runCase(c, model));
  }
  process.stdout.write('\n');
  const scored = score(cases, runs);
  const md = report(mode, model.name, cases, runs, scored);
  const dir = fileURLToPath(new URL('../reports', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}.md`;
  writeFileSync(file, md);
  console.log(md);
  console.log(`Report: ${file}`);
  const t = meetsTargets(scored.metrics);
  if (!t.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
