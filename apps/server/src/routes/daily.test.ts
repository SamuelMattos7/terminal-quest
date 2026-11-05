import { DailyResponseSchema } from '@terminal-quest/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempts, levelProgress, users } from '../db/schema.js';
import { guestCookie, makeLevel, makeTestContext, makeUser } from '../testUtils.js';

const start = Date.parse('2026-11-05T00:00:00Z') / 1000;
const end = Date.parse('2026-11-06T00:00:00Z') / 1000;

async function dailyFixture(...args: Parameters<typeof makeTestContext>) {
  const ctx = await makeTestContext(...args);
  try {
    const cookie = await guestCookie(ctx.app);
    const [user] = ctx.db.select().from(users).all();
    if (user === undefined) throw new Error('guest user missing');
    const request = () => ctx.app.inject({ method: 'GET', url: '/api/daily', headers: { cookie } });
    const daily = async () => {
      const response = await request();
      expect(response.statusCode).toBe(200);
      return DailyResponseSchema.parse(response.json());
    };
    const complete = (levelId: string) =>
      ctx.db.insert(levelProgress).values({ userId: user.id, levelId, completions: 1 }).run();
    return { ...ctx, userId: user.id, request, daily, complete };
  } catch (error) {
    await ctx.cleanup();
    throw error;
  }
}

describe('GET /api/daily', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers an explicitly eligible level only after it unlocks', async () => {
    const first = makeLevel('first', 1, 1);
    first.level.daily_eligible = false;
    const second = makeLevel('second', 1, 2);
    second.level.daily_eligible = true;
    const ctx = await dailyFixture([first, second]);
    try {
      expect((await ctx.request()).statusCode).toBe(404);
      ctx.complete('w1-01-first');
      expect((await ctx.daily()).levelId).toBe('w1-02-second');
    } finally {
      await ctx.cleanup();
    }
  });

  it('offers default eligible lessons after the player clears their world', async () => {
    const boss = makeLevel('boss', 1, 2, 'boss');
    const ctx = await dailyFixture([makeLevel('lesson', 1, 1), boss]);
    try {
      ctx.complete('w1-01-lesson');
      expect((await ctx.request()).statusCode).toBe(404);
      ctx.complete('w1-02-boss');
      const challenge = await ctx.daily();
      expect(challenge.levelId).toBe('w1-01-lesson');
      expect(await ctx.daily()).toEqual(challenge);
    } finally {
      await ctx.cleanup();
    }
  });

  it('excludes disabled worlds even with the unlock override', async () => {
    const disabled = makeLevel('disabled', 2, 1);
    disabled.level.daily_eligible = true;
    const ctx = await dailyFixture([disabled], { ENABLE_WORLDS: [1], UNLOCK_ALL: 1 });
    try {
      expect((await ctx.request()).statusCode).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });

  it('counts only a successful finish by this player on this level within the selected UTC date', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start * 1000);
    const level = makeLevel('daily', 1, 1);
    level.level.daily_eligible = true;
    const other = makeLevel('other', 1, 2);
    other.level.daily_eligible = false;
    const ctx = await dailyFixture([level, other]);
    try {
      const levelId = 'w1-01-daily';
      ctx.complete(levelId);
      const attempt = {
        userId: ctx.userId,
        levelId,
        status: 'completed',
        startedAt: start - 60,
        seed: 1,
      };
      ctx.db
        .insert(attempts)
        .values([
          { ...attempt, id: 'previous-day', endedAt: start - 1 },
          { ...attempt, id: 'next-day', endedAt: end },
          { ...attempt, id: 'abandoned', endedAt: start, status: 'abandoned' },
          { ...attempt, id: 'other-level', endedAt: start, levelId: 'w1-02-other' },
          { ...attempt, id: 'other-user', endedAt: start, userId: makeUser(ctx.db) },
        ])
        .run();
      expect(await ctx.daily()).toEqual({ levelId, date: '2026-11-05', completed: false });
      ctx.db
        .insert(attempts)
        .values({ ...attempt, id: 'midnight-finish', endedAt: start })
        .run();
      expect(await ctx.daily()).toEqual({ levelId, date: '2026-11-05', completed: true });
      clock.mockReturnValue(end * 1000);
      expect(await ctx.daily()).toEqual({ levelId, date: '2026-11-06', completed: true });
    } finally {
      await ctx.cleanup();
    }
  });
});
