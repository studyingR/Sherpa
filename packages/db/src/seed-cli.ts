import { createDb, resolveSeedToday, seed } from './index';
import { toIsoDate } from '@sherpa/shared';

async function main() {
  const db = createDb();
  const today = resolveSeedToday();
  const { accounts } = await seed(db, today);
  console.log(`Seeded ${accounts} accounts for ${toIsoDate(today)}.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
