import type { Db } from '@sherpa/db';

export interface Clock {
  now(): Date;
  /** Seed "today" at local midnight. */
  today(): Date;
}

/**
 * demo: time starts at the seed day's 15:30 local when the server boots, then advances in real time.
 * This keeps the seeded story consistent (the 2 PM Acme meeting has ended; Harbor at 4 PM is upcoming).
 */
export async function createClock(db: Db, mode: 'demo' | 'real', seedTodayEnv?: string): Promise<Clock> {
  const meta = await db.appMeta.findUnique({ where: { key: 'seedToday' } });
  const raw = seedTodayEnv || meta?.value;
  const seedDay = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? (() => { const [y, m, d] = raw.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date(new Date().setHours(0, 0, 0, 0));
  if (mode === 'real') {
    return { now: () => new Date(), today: () => new Date(new Date().setHours(0, 0, 0, 0)) };
  }
  const start = new Date(seedDay);
  start.setHours(15, 30, 0, 0);
  const bootedAt = Date.now();
  return {
    now: () => new Date(start.getTime() + (Date.now() - bootedAt)),
    today: () => new Date(seedDay),
  };
}

/** Fixed/manual clock for tests. */
export function manualClock(start: Date): Clock & { set(d: Date): void; advance(ms: number): void } {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    today: () => new Date(current.getFullYear(), current.getMonth(), current.getDate()),
    set: (d: Date) => {
      current = new Date(d);
    },
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}
