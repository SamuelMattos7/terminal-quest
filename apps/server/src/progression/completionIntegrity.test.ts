import { describe, expect, it } from 'vitest';
import { LevelSchema } from '@terminal-quest/shared';
import { attempts, badges, levelProgress, skillProgress, users } from '../db/schema.js';
import { makeLevel, makeTempDb, makeUser } from '../testUtils.js';
import { endAttempt, openAttempt } from './attempts.js';
import { recordLevelCompletion, type CompletionInput } from './progress.js';

function setup() {
  const ctx = makeTempDb();
  const userId = makeUser(ctx.db);
  const level = LevelSchema.parse(makeLevel('a', 1, 1).level);
  const attemptId = openAttempt(ctx.db, userId, level.id, 7);
  const input: CompletionInput = {
    userId,
    level,
    attemptId,
    seed: 7,
    xpAwarded: 55,
    fullXp: 55,
    rank: 'S',
    hintTiers: [],
    commands: [{ command: 'pwd', exitCode: 0 }],
    bonusDoneIds: [],
    teachesSkills: new Map([
      ['pwd', { id: 'pwd', title: 'pwd', group: 'navigation', world: 1, prereqs: [] }],
    ]),
    badgeList: [{ id: 'first', title: 'First', description: 'First', rule: 'first-command' }],
    levelsById: new Map([[level.id, level]]),
    levelsByWorld: new Map([[1, [level]]]),
  };
  return { ...ctx, input };
}

describe('completion integrity (A02/A13)', () => {
  it('credits a repeated attempt only once, including simultaneous calls', async () => {
    const { db, input, cleanup } = setup();
    try {
      await Promise.all([recordLevelCompletion(db, input), recordLevelCompletion(db, input)]);
      await recordLevelCompletion(db, input);
      expect(db.select().from(users).get()?.xp).toBe(55);
      expect(db.select().from(levelProgress).get()?.completions).toBe(1);
      expect(db.select().from(skillProgress).get()?.uses).toBe(1);
      expect(db.select().from(badges).all()).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it.each(['abandoned', 'expired', 'deleted'] as const)(
    'cannot credit an %s attempt',
    async (status) => {
      const { db, input, cleanup } = setup();
      try {
        if (status === 'deleted') db.delete(attempts).run();
        else endAttempt(db, input.attemptId, status);
        await recordLevelCompletion(db, input);
        expect(db.select().from(users).get()?.xp).toBe(0);
        expect(db.select().from(levelProgress).all()).toEqual([]);
        expect(db.select().from(skillProgress).all()).toEqual([]);
        expect(db.select().from(badges).all()).toEqual([]);
        expect(db.select().from(attempts).get()?.status).toBe(
          status === 'deleted' ? undefined : status,
        );
      } finally {
        cleanup();
      }
    },
  );

  it('does not overwrite a completed attempt when a close arrives later', async () => {
    const { db, input, cleanup } = setup();
    try {
      await recordLevelCompletion(db, input);
      endAttempt(db, input.attemptId, 'expired');
      expect(db.select().from(attempts).get()?.status).toBe('completed');
    } finally {
      cleanup();
    }
  });

  it.each(['user', 'level', 'seed'] as const)(
    'requires matching attempt %s before crediting',
    async (field) => {
      const { db, input, cleanup } = setup();
      try {
        const mismatched = {
          ...input,
          ...(field === 'user' ? { userId: makeUser(db) } : {}),
          ...(field === 'level' ? { level: { ...input.level, id: 'w1-02-b' } } : {}),
          ...(field === 'seed' ? { seed: 8 } : {}),
        };
        await recordLevelCompletion(db, mismatched);
        expect(
          db
            .select()
            .from(users)
            .all()
            .every((u) => u.xp === 0),
        ).toBe(true);
        expect(db.select().from(attempts).get()?.status).toBe('active');
        expect(db.select().from(levelProgress).all()).toEqual([]);
      } finally {
        cleanup();
      }
    },
  );

  it('rolls back every write on a late badge failure and permits a clean retry', async () => {
    const { db, input, cleanup } = setup();
    try {
      db.$client.exec(
        "CREATE TRIGGER fail_badge BEFORE INSERT ON badges BEGIN SELECT RAISE(ABORT, 'badge write failed'); END",
      );
      await expect(Promise.resolve().then(() => recordLevelCompletion(db, input))).rejects.toThrow(
        'badge write failed',
      );
      expect(db.select().from(attempts).get()).toMatchObject({
        status: 'active',
        xpAwarded: 0,
        endedAt: null,
      });
      expect(db.select().from(users).get()).toMatchObject({
        xp: 0,
        streakDays: 0,
        lastActiveDay: null,
      });
      expect(db.select().from(levelProgress).all()).toEqual([]);
      expect(db.select().from(skillProgress).all()).toEqual([]);
      expect(db.select().from(badges).all()).toEqual([]);
      db.$client.exec('DROP TRIGGER fail_badge');
      await recordLevelCompletion(db, input);
      expect(db.select().from(users).get()?.xp).toBe(55);
      expect(db.select().from(levelProgress).get()?.completions).toBe(1);
      expect(db.select().from(skillProgress).get()?.uses).toBe(1);
      expect(db.select().from(attempts).get()?.status).toBe('completed');
    } finally {
      cleanup();
    }
  });
});
