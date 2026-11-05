import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { attempts } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { LoggedCommand } from '../engine/checks/context.js';
import { countCommands } from '../engine/cmdlog.js';
import { checkManualBonus } from '../engine/scoring.js';

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

interface AttemptMetrics {
  hintTiers: readonly number[];
  commands: readonly LoggedCommand[];
}

function hintMetrics(hintTiers: readonly number[]) {
  return { hintsUsed: hintTiers.length, hintTiersJson: JSON.stringify(hintTiers) };
}

function attemptMetrics(input: AttemptMetrics) {
  const commands = input.commands.map((entry) => entry.command);
  return {
    ...hintMetrics(input.hintTiers),
    commandsCount: countCommands(commands),
    usedManual: checkManualBonus(commands) ? 1 : 0,
  };
}

export function saveAttemptHints(db: Db, id: string, hintTiers: readonly number[]): void {
  db.update(attempts)
    .set(hintMetrics(hintTiers))
    .where(and(eq(attempts.id, id), eq(attempts.status, 'active')))
    .run();
}

export interface FinishAttemptInput extends AttemptMetrics {
  endedAt?: number;
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
      ...attemptMetrics(input),
      xpAwarded: input.xpAwarded,
      rank: input.rank,
    })
    .where(and(eq(attempts.id, id), eq(attempts.status, 'active')))
    .run();
}

export function endAttempt(
  db: Db,
  id: string,
  status: AttemptEndStatus,
  metrics: AttemptMetrics,
  now = Date.now(),
): void {
  db.update(attempts)
    .set({ endedAt: Math.floor(now / 1000), status, ...attemptMetrics(metrics) })
    .where(and(eq(attempts.id, id), eq(attempts.status, 'active')))
    .run();
}
