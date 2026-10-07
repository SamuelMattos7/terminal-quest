// Player XP levels for plan.md §10.2. Threshold(n) = round(100 * n^1.5)
// is the total XP needed to reach level n+1; everyone starts at level 1.

export function xpForLevel(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`xpForLevel needs a positive integer, got ${n}`);
  }
  return Math.round(100 * n ** 1.5);
}

export function playerLevel(xp: number): number {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (total >= xpForLevel(level)) {
    level += 1;
  }
  return level;
}

export function xpToNext(xp: number): number {
  return xpForLevel(playerLevel(Math.max(0, Math.floor(xp)))) - Math.max(0, Math.floor(xp));
}
