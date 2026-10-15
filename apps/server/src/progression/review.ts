import { eq } from 'drizzle-orm';
import type { Level } from '@terminal-quest/shared';
import type { Db } from '../db/client.js';
import { levelProgress, skillProgress } from '../db/schema.js';

// Spaced-repetition due list for plan.md §10.5 (T3.3 owns the endpoint;
// T6.1 wires the 25%-XP replay rule).
//
// Time unit is UNIX SECONDS throughout (matches skill_progress.last_used_at
// as written by creditSkills; D-017 fixed an ms/s mismatch here).

export interface ReviewSkillState {
  skillId: string;
  uses: number;
  lastUsedAt: number | null;
  levelsUsed: string[];
}

export interface ReviewItem {
  skillId: string;
  levelId: string;
}

function intervalSeconds(uses: number): number {
  if (uses <= 1) {
    return 3 * 86_400;
  }
  if (uses === 2) {
    return 7 * 86_400;
  }
  return 21 * 86_400;
}

/**
 * For each learned skill past its interval, suggest any completed level
 * teaching it for replay.
 */
export function reviewDue(
  skills: ReviewSkillState[],
  teachesByLevel: Map<string, string[]>,
  completedLevelIds: Set<string>,
  now = Math.floor(Date.now() / 1000),
): ReviewItem[] {
  const due: ReviewItem[] = [];
  for (const skill of skills) {
    if (skill.lastUsedAt === null || now - skill.lastUsedAt <= intervalSeconds(skill.uses)) {
      continue;
    }
    const levelId = [...completedLevelIds]
      .sort()
      .find((id) => (teachesByLevel.get(id) ?? []).includes(skill.skillId));
    if (levelId !== undefined) {
      due.push({ skillId: skill.skillId, levelId });
    }
  }
  return due;
}

/**
 * Was this level due for spaced-repetition review when the user completed
 * it just now? Used to apply the 25%-of-base replay rule (§10.5) instead of
 * the improvement-over-best rule. A first clear is never a review replay.
 */
export async function wasReviewDue(
  db: Db,
  userId: string,
  level: Level,
  levelsById: Map<string, Level>,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const [skillRows, progressRows] = await Promise.all([
    db.select().from(skillProgress).where(eq(skillProgress.userId, userId)).all(),
    db.select().from(levelProgress).where(eq(levelProgress.userId, userId)).all(),
  ]);
  const completed = new Set(progressRows.filter((r) => r.completions > 0).map((r) => r.levelId));
  if (!completed.has(level.id)) {
    return false;
  }
  const teachesByLevel = new Map<string, string[]>();
  for (const [id, other] of levelsById) {
    if (completed.has(id)) {
      teachesByLevel.set(id, other.teaches);
    }
  }
  return reviewDue(
    skillRows.map((r) => ({
      skillId: r.skillId,
      uses: r.uses,
      lastUsedAt: r.lastUsedAt,
      levelsUsed: [],
    })),
    teachesByLevel,
    completed,
    now,
  ).some((item) => item.levelId === level.id);
}
