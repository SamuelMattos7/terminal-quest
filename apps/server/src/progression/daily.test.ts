import { describe, expect, it } from 'vitest';
import type { Level } from '@terminal-quest/shared';
import { dailyLevel, hashDate, isDailyEligible } from './daily.js';

function level(id: string, kind: 'lesson' | 'boss' = 'lesson', difficulty = 1): Level {
  return {
    id,
    world: 1,
    order: 1,
    title: id,
    kind,
    difficulty,
    estimated_minutes: 3,
    story: 'story',
    teaches: ['pwd'],
    par_commands: 2,
    xp: 50,
    sandbox: {
      profile: 'basic',
      network: 'none',
      sidecars: [],
      image: 'tq-base',
      start_cwd: '/home/player',
      resources: { memory_mb: 256, cpus: 0.5, pids: 128 },
      capabilities: [],
      sudo_allow: [],
      needs_cron: true,
    },
    objectives: [],
    hints: ['a', 'b', 'c'],
    coach: [],
    explain: [],
    cheatsheet: [],
    success_message: 'done',
    forbidden_commands: [],
    solutions: { reference: 'solution.sh', wrong: [] },
  };
}

describe('daily picker', () => {
  it('is deterministic per date', () => {
    const pool = [level('w1-01-a'), level('w1-02-b'), level('w1-03-c')];
    expect(dailyLevel(pool, '2026-10-07')?.id).toBe(pool[hashDate('2026-10-07') % 3]?.id);
    expect(dailyLevel(pool, '2026-10-07')?.id).toBe(dailyLevel(pool, '2026-10-07')?.id);
  });

  it('returns undefined for an empty pool', () => {
    expect(dailyLevel([], '2026-10-07')).toBeUndefined();
  });

  it('gates eligibility on lessons of difficulty 3 or less', () => {
    expect(isDailyEligible(level('a'))).toBe(true);
    expect(isDailyEligible(level('b', 'lesson', 5))).toBe(false);
    expect(isDailyEligible(level('c', 'boss', 1))).toBe(false);
    expect(isDailyEligible({ ...level('d'), daily_eligible: false })).toBe(false);
    expect(isDailyEligible({ ...level('e', 'boss'), daily_eligible: true })).toBe(true);
  });
});
