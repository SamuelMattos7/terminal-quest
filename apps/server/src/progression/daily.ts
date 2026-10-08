import type { Level } from '@terminal-quest/shared';

// Daily challenge picker for plan.md §10.5: deterministic per UTC date.

export function hashDate(date: string): number {
  let sum = 0;
  for (const ch of date) {
    sum += ch.codePointAt(0) ?? 0;
  }
  return sum;
}

/** Eligible by default: lessons with difficulty ≤ 3 unless opted out. */
export function isDailyEligible(level: Level): boolean {
  if (level.daily_eligible !== undefined) {
    return level.daily_eligible;
  }
  return level.kind === 'lesson' && level.difficulty <= 3;
}

export function dailyLevel(levels: Level[], date: string): Level | undefined {
  if (levels.length === 0) {
    return undefined;
  }
  return levels[hashDate(date) % levels.length];
}
