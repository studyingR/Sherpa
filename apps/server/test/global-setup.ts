import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** A dedicated SQLite file for tests: never the dev database. */
export default function setup() {
  const dbDir = fileURLToPath(new URL('../../../packages/db', import.meta.url));
  execSync('npx prisma db push --skip-generate', {
    cwd: dbDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
}
