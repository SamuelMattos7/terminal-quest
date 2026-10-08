import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LevelSchema, type Level, type Skill } from '@terminal-quest/shared';
import { computeScore } from '../engine/scoring.js';
import { attempts, levelProgress, users } from '../db/schema.js';
import { makeTempDb, makeUser } from '../testUtils.js';
import { openAttempt } from './attempts.js';
import { recordLevelCompletion } from './progress.js';
import type { Badge } from './badges.js';

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
    xp: 100,
    sandbox: {
      profile: 'basic',
      network: 'none',
      image: 'tq-base',
      start_cwd: '/home/player',
    },
    objectives: [{ id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/a' } }],
    hints: ['a', 'b', 'c'],
    success_message: 'done',
    solutions: { reference: 'solution.sh' },
    ...overrides,
  });
}

const skills = new Map<string, Skill>([
  ['pwd', { id: 'pwd', title: 'pwd', group: 'navigation', world: 1, prereqs: [] }],
]);
const badgeList: Badge[] = [
  { id: 'first-command', title: 'F', description: 'D', rule: 'first-command' },
];

async function complete(
  db: ReturnType<typeof makeTempDb>['db'],
  userId: string,
  level: Level,
  scored: { xp: number; fullXp: number },
  rank: string,
) {
  const attemptId = openAttempt(db, userId, level.id, 7);
  const result = await recordLevelCompletion(db, {
    userId,
    level,
    attemptId,
    seed: 7,
    xpAwarded: scored.xp,
    fullXp: scored.fullXp,
    rank,
    hintTiers: [],
    commands: [
      { command: 'pwd', exitCode: 0 },
      { command: 'ls', exitCode: 0 },
    ],
    bonusDoneIds: [],
    teachesSkills: skills,
    badgeList,
    levelsById: new Map([[level.id, level]]),
    levelsByWorld: new Map([[1, [level]]]),
    now: Date.parse('2026-10-07T12:00:00Z'),
  });
  return result;
}

describe('recordLevelCompletion', () => {
  it('persists attempt, progress, XP, skills, streak, and first badge', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const level = makeLevel();
      const { newBadges } = await complete(db, userId, level, { xp: 110, fullXp: 110 }, 'S');

      const [attempt] = db.select().from(attempts).all();
      expect(attempt).toMatchObject({
        status: 'completed',
        xpAwarded: 110,
        rank: 'S',
        commandsCount: 2,
      });

      const [progress] = db.select().from(levelProgress).all();
      expect(progress).toMatchObject({ bestXp: 110, bestRank: 'S', completions: 1 });

      const [user] = db.select().from(users).where(eq(users.id, userId)).all();
      expect(user?.xp).toBe(110);
      expect(user?.streakDays).toBe(1);
      expect(user?.lastActiveDay).toBe('2026-10-07');
      expect(newBadges).toContain('first-command');
    } finally {
      cleanup();
    }
  });

  it('awards only the improvement on repeats, never negative', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const level = makeLevel();
      // First clear through real scoring: base 100 + first-clear 10.
      const first = computeScore({
        level,
        hintTiers: [],
        commandCount: 2,
        bonusDoneIds: [],
        manualBonus: false,
        isFirstClear: true,
        bestXp: 0,
      });
      expect(first.xp).toBe(110);
      await complete(db, userId, level, first, 'S');

      // Worse rerun: full 90 < best 110 → awarded 0, totals frozen.
      const worse = computeScore({
        level,
        hintTiers: [2],
        commandCount: 2,
        bonusDoneIds: [],
        manualBonus: false,
        isFirstClear: false,
        bestXp: 110,
      });
      expect(worse.xp).toBe(0);
      const before = (await db.select().from(users).where(eq(users.id, userId)).all())[0]?.xp;
      const { newBadges } = await complete(db, userId, level, worse, 'B');
      const after = (await db.select().from(users).where(eq(users.id, userId)).all())[0];
      expect(after?.xp).toBe(before);
      expect(newBadges).not.toContain('first-command');
      const [progress] = db.select().from(levelProgress).all();
      expect(progress).toMatchObject({ bestXp: 110, bestRank: 'S', completions: 2 });
    } finally {
      cleanup();
    }
  });

  it('extends streaks across days and resets after a skip', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const level = makeLevel();
      const day = (d: string): number => Date.parse(`${d}T12:00:00Z`);
      async function completeOn(
        dayStr: string,
        scored: { xp: number; fullXp: number },
      ): Promise<void> {
        const attemptId = openAttempt(db, userId, level.id, 8);
        await recordLevelCompletion(db, {
          userId,
          level,
          attemptId,
          seed: 8,
          xpAwarded: scored.xp,
          fullXp: scored.fullXp,
          rank: 'C',
          hintTiers: [],
          commands: [],
          bonusDoneIds: [],
          teachesSkills: skills,
          badgeList: [],
          levelsById: new Map([[level.id, level]]),
          levelsByWorld: new Map([[1, [level]]]),
          now: day(dayStr),
        });
      }
      await completeOn('2026-10-06', { xp: 10, fullXp: 10 });
      await completeOn('2026-10-07', { xp: 10, fullXp: 10 });
      const continued = (await db.select().from(users).where(eq(users.id, userId)).all())[0];
      expect(continued?.streakDays).toBe(2);
      await completeOn('2026-10-09', { xp: 10, fullXp: 10 });
      const reset = (await db.select().from(users).where(eq(users.id, userId)).all())[0];
      expect(reset?.streakDays).toBe(1);
      expect(reset?.lastActiveDay).toBe('2026-10-09');
    } finally {
      cleanup();
    }
  });
});
