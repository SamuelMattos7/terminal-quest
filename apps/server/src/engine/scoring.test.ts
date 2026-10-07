import { describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import {
  checkManualBonus,
  computeRank,
  computeScore,
  computeScoreWithCommands,
  hintPenaltyPct,
} from './scoring.js';

function makeLevel(overrides: Record<string, unknown> = {}): Level {
  return LevelSchema.parse({
    id: 'w1-02-where-am-i',
    world: 1,
    order: 2,
    title: 'Where Am I?',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 4,
    story: 'A short story.',
    teaches: ['pwd'],
    par_commands: 4,
    xp: 100,
    objectives: [
      { id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/home/player/a.txt' } },
    ],
    hints: ['one', 'two', 'three'],
    success_message: 'Done.',
    solutions: { reference: 'solution.sh' },
    ...overrides,
  });
}

describe('hintPenaltyPct', () => {
  it('sums tiers and caps at 40', () => {
    expect(hintPenaltyPct([])).toBe(0);
    expect(hintPenaltyPct([1])).toBe(5);
    expect(hintPenaltyPct([1, 2, 3])).toBe(40);
    expect(hintPenaltyPct([3, 3, 3])).toBe(40);
  });
});

describe('computeScore', () => {
  it('awards an S with base + first-clear bonus and no penalties', () => {
    const result = computeScore({
      level: makeLevel(),
      hintTiers: [],
      commandCount: 3,
      bonusDoneIds: [],
      manualBonus: false,
      isFirstClear: true,
      bestXp: 0,
    });
    expect(result.rank).toBe('S');
    expect(result.xp).toBe(110);
    expect(result.breakdown).toEqual([
      { label: 'base', xp: 100 },
      { label: 'first clear', xp: 10 },
    ]);
  });

  it('applies hint penalties to the base', () => {
    const result = computeScore({
      level: makeLevel(),
      hintTiers: [2],
      commandCount: 3,
      bonusDoneIds: [],
      manualBonus: false,
      isFirstClear: true,
      bestXp: 0,
    });
    expect(result.rank).toBe('A');
    expect(result.xp).toBe(90 + 10);
    expect(result.breakdown[1]).toEqual({ label: 'hints (-10%)', xp: -10 });
  });

  it('adds manual and bonus-objective XP', () => {
    const result = computeScore({
      level: makeLevel({
        objectives: [
          { id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/a' } },
          { id: 'style', text: 'Bonus.', bonus: true, check: { type: 'file_exists', path: '/b' } },
          { id: 'extra', text: 'Bonus.', bonus: true, check: { type: 'file_exists', path: '/c' } },
        ],
      }),
      hintTiers: [],
      commandCount: 3,
      bonusDoneIds: ['style', 'extra'],
      manualBonus: true,
      isFirstClear: true,
      bestXp: 0,
    });
    expect(result.rank).toBe('S');
    expect(result.xp).toBe(100 + 10 + 5 + 20);
  });

  it('denies S when a bonus objective is missing', () => {
    const result = computeScore({
      level: makeLevel({
        objectives: [
          { id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/a' } },
          { id: 'style', text: 'Bonus.', bonus: true, check: { type: 'file_exists', path: '/b' } },
        ],
      }),
      hintTiers: [],
      commandCount: 3,
      bonusDoneIds: [],
      manualBonus: false,
      isFirstClear: true,
      bestXp: 0,
    });
    expect(result.rank).toBe('A');
  });

  it('awards only the improvement on repeats, never negative', () => {
    const input = {
      level: makeLevel(),
      hintTiers: [] as number[],
      commandCount: 3,
      bonusDoneIds: [] as string[],
      manualBonus: false,
      isFirstClear: false,
      bestXp: 60,
    };
    expect(computeScore(input).xp).toBe(40);
    expect(computeScore({ ...input, bestXp: 200 }).xp).toBe(0);
  });

  it('ranks B within 3 hints', () => {
    const result = computeScore({
      level: makeLevel(),
      hintTiers: [1, 2],
      commandCount: 50,
      bonusDoneIds: [],
      manualBonus: false,
      isFirstClear: true,
      bestXp: 0,
    });
    expect(result.rank).toBe('B');
    expect(computeRank(makeLevel(), 4, 999, false)).toBe('C');
  });
});

describe('computeScoreWithCommands', () => {
  it('derives manual bonus and command count from the log', () => {
    const result = computeScoreWithCommands({
      level: makeLevel(),
      hintTiers: [],
      bonusDoneIds: [],
      isFirstClear: true,
      bestXp: 0,
      commands: ['pwd', 'man ls', 'clear', 'tux submit x'],
    });
    expect(result.xp).toBe(100 + 10 + 5);
    expect(result.rank).toBe('S');
  });
});

describe('checkManualBonus', () => {
  it('detects man, tldr, --help, and -h usage', () => {
    expect(checkManualBonus(['man ls', 'ls --help', 'tldr grep', 'tool -h'])).toBe(true);
    expect(checkManualBonus(['ls -la', 'echo hi'])).toBe(false);
  });
});
