/**
 * Manage who may sign in with Google.
 *   pnpm auth:allow you@example.com u_maya
 *   pnpm auth:revoke you@example.com
 *   pnpm auth:list
 */
import { createDb } from './index';

async function main() {
  const [cmd, emailArg, userId] = process.argv.slice(2);
  const db = createDb();
  const email = emailArg?.trim().toLowerCase();
  if (cmd === 'allow') {
    if (!email || !userId) throw new Error('Usage: pnpm auth:allow <email> <userId>');
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error(`No Sherpa user ${userId}. Known: ${(await db.user.findMany()).map((u) => u.id).join(', ')}`);
    await db.authIdentity.upsert({ where: { email }, create: { email, userId }, update: { userId } });
    console.log(`${email} can now sign in as ${user.name} (${user.role}).`);
  } else if (cmd === 'revoke') {
    if (!email) throw new Error('Usage: pnpm auth:revoke <email>');
    await db.authIdentity.deleteMany({ where: { email } });
    console.log(`${email} can no longer sign in.`);
  } else {
    for (const a of await db.authIdentity.findMany({ orderBy: { email: 'asc' } })) console.log(`${a.email} → ${a.userId}${a.lastLoginAt ? ` (last sign-in ${a.lastLoginAt.toISOString()})` : ''}`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
