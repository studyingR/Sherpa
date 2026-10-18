import { PrismaClient } from '@prisma/client';

export { PrismaClient, Prisma } from '@prisma/client';
export { seed, clearAll, resolveSeedToday, ACCOUNT_IDS, MEETING_IDS } from './seed';

export type Db = PrismaClient;

export function createDb(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}
