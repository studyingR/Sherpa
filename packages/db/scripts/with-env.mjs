// Loads the repo-root .env (if present) and runs the given command with it.
// Defaults DATABASE_URL so `pnpm db:reset` works on a fresh clone.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
const [cmd, ...args] = process.argv.slice(2);
const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: process.env });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
