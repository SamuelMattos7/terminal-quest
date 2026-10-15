import { describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import { levelProgress, skillProgress } from '../db/schema.js';
import { makeTempDb, makeUser } from '../testUtils.js';
import { reviewDue, wasReviewDue } from './review.js';

function makeLevel(overrides: Record<string, unknown> = {}): Level {
  return LevelSchema.parse({
    id: 'w1-01-a',
    world: 1,
    order: 1,
    title: 'Title',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 3,
    story: 'story',
    teaches: ['pwd'],
    par_commands: 4,
    xp: 50,
    objectives: [{ id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/a' } }],
    hints: ['a', 'b', 'c'],
    success_message: 'done',
    solutions: { reference: 'solution.sh' },
    ...overrides,
  });
}

describe('reviewDue', () => {
  it('lists skills past their interval with a completed teaching level', () => {
    const day = 86_400;
    const teaches = new Map([
      ['w1-01-a', ['pwd']],
      ['w1-02-b', ['ls']],
    ]);
    const due = reviewDue(
      [
        { skillId: 'pwd', uses: 1, lastUsedAt: 0, levelsUsed: ['w1-01-a'] },
        { skillId: 'ls', uses: 1, lastUsedAt: 0, levelsUsed: ['w1-02-b'] },
      ],
      teaches,
      new Set(['w1-01-a', 'w1-02-b']),
      31 * day,
    );
    expect(due).toEqual([
      { skillId: 'pwd', levelId: 'w1-01-a' },
      { skillId: 'ls', levelId: 'w1-02-b' },
    ]);
  });

  it('skips fresh skills and skills with no completed teaching level', () => {
    const day = 86_400;
    const due = reviewDue(
      [
        { skillId: 'pwd', uses: 1, lastUsedAt: 29 * day, levelsUsed: ['w1-01-a'] },
        { skillId: 'ghost', uses: 1, lastUsedAt: 0, levelsUsed: [] },
      ],
      new Map([['w1-01-a', ['pwd']]]),
      new Set(['w1-01-a']),
      30 * day,
    );
    expect(due).toEqual([]);
  });
});

describe('wasReviewDue', () => {
  const day = 86_400;
  const now = 100 * day;

  function seed(userId: string, db: ReturnType<typeof makeTempDb>['db'], lastUsedAt: number) {
    db.insert(levelProgress)
      .values({ userId, levelId: 'w1-01-a', bestRank: 'A', bestXp: 40, completions: 1 })
      .run();
    db.insert(skillProgress).values({ userId, skillId: 'pwd', uses: 1, lastUsedAt }).run();
  }

  it('is true when the level teaches an overdue skill', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      seed(userId, db, now - 10 * day);
      const level = makeLevel();
      await expect(
        wasReviewDue(db, userId, level, new Map([[level.id, level]]), now),
      ).resolves.toBe(true);
    } finally {
      cleanup();
    }
  });

  it('is false on first clear and when the skill is fresh', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const level = makeLevel();
      // Never completed: first clear, not a replay.
      db.insert(skillProgress)
        .values({ userId, skillId: 'pwd', uses: 1, lastUsedAt: now - 10 * day })
        .run();
      await expect(
        wasReviewDue(db, userId, level, new Map([[level.id, level]]), now),
      ).resolves.toBe(false);
      // Completed but used yesterday: not overdue.
      db.insert(levelProgress)
        .values({ userId, levelId: 'w1-01-a', bestRank: 'A', bestXp: 40, completions: 1 })
        .run();
      db.insert(skillProgress)
        .values({ userId, skillId: 'ls', uses: 5, lastUsedAt: now - day })
        .run();
      const level2 = makeLevel({ id: 'w1-02-b', teaches: ['ls'] });
      db.insert(levelProgress).values({ userId, levelId: 'w1-02-b', completions: 1 }).run();
      await expect(
        wasReviewDue(db, userId, level2, new Map([[level2.id, level2]]), now),
      ).resolves.toBe(false);
    } finally {
      cleanup();
    }
  });
});
