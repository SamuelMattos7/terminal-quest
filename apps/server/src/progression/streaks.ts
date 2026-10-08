// UTC-day streaks for plan.md §10.5. Pure date math; the caller persists.

export function dayString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function yesterdayOf(todayDay: string): string {
  const ms = Date.parse(`${todayDay}T00:00:00Z`) - 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Next streak value given the stored day/count and today (all UTC). */
export function nextStreakDays(
  current: number,
  lastActiveDay: string | null,
  todayDay: string,
): number {
  if (lastActiveDay === todayDay) {
    return current;
  }
  if (lastActiveDay !== null && lastActiveDay === yesterdayOf(todayDay)) {
    return current + 1;
  }
  return 1;
}
