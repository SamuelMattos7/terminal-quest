import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { attempts } from '../db/schema.js';
import type { Db } from '../db/client.js';

// Attempt rows for plan.md §5. Opened at session start, finished on
// completion, abandoned on reset/delete/replace, expired by the reaper.

export type AttemptEndStatus = 'abandoned' | 'expired';

export function openAttempt(
  db: Db,
  userId: string,
  levelId: string,
  seed: number,
  now = Date.now(),
): string {
  const id = randomUUID();
  db.insert(attempts)
    .values({ id, userId, levelId, seed, startedAt: Math.floor(now / 1000), status: 'active' })
    .run();
  return id;
}

export interface FinishAttemptInput {
  endedAt?: number;
  hintsUsed: number;
  hintTiers: number[];
  commandsCount: number;
  usedManual: boolean;
  xpAwarded: number;
  rank: string;
}

export function finishAttempt(
  db: Db,
  id: string,
  input: FinishAttemptInput,
  now = Date.now(),
): void {
  db.update(attempts)
    .set({
      endedAt: Math.floor((input.endedAt ?? now) / 1000),
      status: 'completed',
      hintsUsed: input.hintsUsed,
      hintTiersJson: JSON.stringify(input.hintTiers),
      commandsCount: input.commandsCount,
      usedManual: input.usedManual ? 1 : 0,
      xpAwarded: input.xpAwarded,
      rank: input.rank,
    })
    .where(eq(attempts.id, id))
    .run();
}

export function endAttempt(db: Db, id: string, status: AttemptEndStatus, now = Date.now()): void {
  db.update(attempts)
    .set({ endedAt: Math.floor(now / 1000), status })
    .where(eq(attempts.id, id))
    .run();
}
