import { and, eq } from 'drizzle-orm';
import type { Level, Skill } from '@terminal-quest/shared';
import { levelProgress, users } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { LoggedCommand } from '../engine/checks/context.js';
import { countCommands } from '../engine/cmdlog.js';
import { checkManualBonus } from '../engine/scoring.js';
import { dayString, nextStreakDays } from './streaks.js';
import { finishAttempt } from './attempts.js';
import { creditSkills } from './skills.js';
import { evaluateBadges, type Badge } from './badges.js';

// Completion persistence (T3.3): attempt row, level progress, user XP,
// skills, streak, and badges — all from one computed score.

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

function betterRank(current: string | null, candidate: string): string {
  if (current === null) {
    return candidate;
  }
  return (RANK_ORDER[candidate] ?? 99) < (RANK_ORDER[current] ?? 99) ? candidate : current;
}

export interface CompletionInput {
  userId: string;
  level: Level;
  attemptId: string;
  seed: number;
  xpAwarded: number;
  fullXp: number;
  rank: string;
  hintTiers: number[];
  commands: LoggedCommand[];
  bonusDoneIds: string[];
  teachesSkills: Map<string, Skill>;
  badgeList: Badge[];
  levelsById: Map<string, Level>;
  levelsByWorld: Map<number, Level[]>;
  now?: number;
}

export interface CompletionResult {
  newBadges: string[];
}

export async function recordLevelCompletion(
  db: Db,
  input: CompletionInput,
): Promise<CompletionResult> {
  const now = input.now ?? Date.now();
  const commandTexts = input.commands.map((c) => c.command);

  finishAttempt(db, input.attemptId, {
    endedAt: now,
    hintsUsed: input.hintTiers.length,
    hintTiers: input.hintTiers,
    commandsCount: countCommands(commandTexts),
    usedManual: checkManualBonus(commandTexts),
    xpAwarded: input.xpAwarded,
    rank: input.rank,
  });

  const [existing] = db
    .select()
    .from(levelProgress)
    .where(and(eq(levelProgress.userId, input.userId), eq(levelProgress.levelId, input.level.id)))
    .all();
  const completions = (existing?.completions ?? 0) + 1;
  if (existing === undefined) {
    db.insert(levelProgress)
      .values({
        userId: input.userId,
        levelId: input.level.id,
        bestRank: input.rank,
        bestXp: input.xpAwarded,
        completions,
        firstCompletedAt: Math.floor(now / 1000),
      })
      .run();
  } else {
    db.update(levelProgress)
      .set({
        bestRank: betterRank(existing.bestRank, input.rank),
        bestXp: Math.max(existing.bestXp, input.fullXp),
        completions,
      })
      .where(and(eq(levelProgress.userId, input.userId), eq(levelProgress.levelId, input.level.id)))
      .run();
  }

  const [user] = db.select().from(users).where(eq(users.id, input.userId)).all();
  if (user === undefined) {
    throw new Error(`recordLevelCompletion: unknown user ${input.userId}`);
  }
  const today = dayString(now);
  const streakDays = nextStreakDays(user.streakDays, user.lastActiveDay, today);
  db.update(users)
    .set({ xp: user.xp + input.xpAwarded, streakDays, lastActiveDay: today })
    .where(eq(users.id, input.userId))
    .run();

  creditSkills(db, {
    userId: input.userId,
    levelId: input.level.id,
    teaches: input.level.teaches,
    skills: input.teachesSkills,
    successfulCommands: input.commands.filter((c) => c.exitCode === 0).map((c) => c.command),
    now,
  });

  const completedIds = new Set(
    db
      .select()
      .from(levelProgress)
      .where(eq(levelProgress.userId, input.userId))
      .all()
      .filter((r) => r.completions > 0)
      .map((r) => r.levelId),
  );
  const newBadges = await evaluateBadges(
    db,
    input.userId,
    input.badgeList,
    {
      levelId: input.level.id,
      rank: input.rank,
      commands: commandTexts,
      hintsUsed: input.hintTiers.length,
    },
    { levelsById: input.levelsById, levelsByWorld: input.levelsByWorld },
    completedIds,
    now,
  );
  return { newBadges };
}
