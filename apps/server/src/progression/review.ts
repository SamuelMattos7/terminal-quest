// Spaced-repetition due list for plan.md §10.5 (T3.3 owns the endpoint;
// the 25%-XP replay wiring waits for T6.1 review UI).

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

function intervalMs(uses: number): number {
  if (uses <= 1) {
    return 3 * 86_400_000;
  }
  if (uses === 2) {
    return 7 * 86_400_000;
  }
  return 21 * 86_400_000;
}

/**
 * For each learned skill past its interval, suggest any completed level
 * teaching it for replay.
 */
export function reviewDue(
  skills: ReviewSkillState[],
  teachesByLevel: Map<string, string[]>,
  completedLevelIds: Set<string>,
  now = Date.now(),
): ReviewItem[] {
  const due: ReviewItem[] = [];
  for (const skill of skills) {
    if (skill.lastUsedAt === null || now - skill.lastUsedAt <= intervalMs(skill.uses)) {
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
