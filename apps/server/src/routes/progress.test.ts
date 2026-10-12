import { describe, expect, it } from 'vitest';
import {
  BadgesResponseSchema,
  OkResponseSchema,
  ProgressResponseSchema,
  ReviewResponseSchema,
  SkillsResponseSchema,
  SpellbookResponseSchema,
  DailyResponseSchema,
} from '@terminal-quest/shared';
import {
  attempts,
  badges,
  levelProgress,
  skillProgress,
  spellbookNotes,
  users,
} from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

const tree = [makeLevel('a', 1, 1), makeLevel('b', 1, 2)];

describe('GET /api/progress', () => {
  it('reports per-level progress and totals', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      ctx.db
        .insert(levelProgress)
        .values({ userId: user.id, levelId: 'w1-01-a', bestRank: 'A', bestXp: 60, completions: 2 })
        .run();
      ctx.db.update(users).set({ xp: 60 }).where(eq(users.id, user.id)).run();
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/progress',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = ProgressResponseSchema.parse(res.json());
      expect(body.levels['w1-01-a']).toMatchObject({ bestRank: 'A', bestXp: 60, completions: 2 });
      expect(body.totals).toMatchObject({
        xp: 60,
        completions: 2,
        levelsCompleted: 1,
        hintsUsed: 0,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects anonymous callers', async () => {
    const ctx = await makeTestContext(tree);
    try {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/progress' })).statusCode).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('GET /api/skills', () => {
  it('lists the skill graph with user mastery', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      ctx.db
        .insert(skillProgress)
        .values({
          userId: user.id,
          skillId: 'pwd',
          uses: 3,
          levelsUsedJson: '["a","b","c"]',
          masteredAt: 5,
          lastUsedAt: 6,
        })
        .run();
      const res = await ctx.app.inject({ method: 'GET', url: '/api/skills', headers: { cookie } });
      const body = SkillsResponseSchema.parse(res.json());
      expect(body.skills.find((s) => s.id === 'pwd')).toMatchObject({ uses: 3, masteredAt: 5 });
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('spellbook', () => {
  it('saves notes with a 2000-char cap and exports markdown', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const put = await ctx.app.inject({
        method: 'PUT',
        url: '/api/spellbook/pwd/note',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ note: 'my note' }),
      });
      expect(put.statusCode).toBe(200);
      const tooLong = await ctx.app.inject({
        method: 'PUT',
        url: '/api/spellbook/pwd/note',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ note: 'x'.repeat(2001) }),
      });
      expect(tooLong.statusCode).toBe(400);
      const unknown = await ctx.app.inject({
        method: 'PUT',
        url: '/api/spellbook/nope/note',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ note: 'hi' }),
      });
      expect(unknown.statusCode).toBe(404);
      const book = SpellbookResponseSchema.parse(
        (
          await ctx.app.inject({ method: 'GET', url: '/api/spellbook', headers: { cookie } })
        ).json(),
      );
      expect(book.entries).toEqual([]);
      const exported = await ctx.app.inject({
        method: 'GET',
        url: '/api/spellbook/export',
        headers: { cookie },
      });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers['content-type']).toContain('text/markdown');
      expect(exported.body).toContain('# Spellbook');
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('GET /api/badges', () => {
  it('returns the catalog with earned state', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      // Fixture catalog is empty: unknown earned ids are ignored, shape holds.
      ctx.db.insert(badges).values({ userId: user.id, badgeId: 'ghost', earnedAt: 9 }).run();
      const body = BadgesResponseSchema.parse(
        (await ctx.app.inject({ method: 'GET', url: '/api/badges', headers: { cookie } })).json(),
      );
      expect(body.badges).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects anonymous callers', async () => {
    const ctx = await makeTestContext(tree);
    try {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/badges' })).statusCode).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('DELETE /api/progress', () => {
  it('wipes completions, xp, streaks, and badges but keeps identity and notes', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      ctx.db
        .update(users)
        .set({ xp: 120, streakDays: 4, displayName: 'Keeper' })
        .where(eq(users.id, user.id))
        .run();
      ctx.db
        .insert(levelProgress)
        .values({ userId: user.id, levelId: 'w1-01-a', bestRank: 'A', bestXp: 60, completions: 2 })
        .run();
      ctx.db.insert(skillProgress).values({ userId: user.id, skillId: 'pwd', uses: 3 }).run();
      ctx.db
        .insert(badges)
        .values({ userId: user.id, badgeId: 'first-command', earnedAt: 8 })
        .run();
      ctx.db
        .insert(attempts)
        .values({
          id: 'att-1',
          userId: user.id,
          levelId: 'w1-01-a',
          seed: 1,
          startedAt: 1,
          status: 'finished',
          hintsUsed: 2,
        })
        .run();
      ctx.db
        .insert(spellbookNotes)
        .values({ userId: user.id, skillId: 'pwd', note: 'precious', updatedAt: 2 })
        .run();
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/progress',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(OkResponseSchema.parse(res.json())).toEqual({ ok: true });
      expect(ctx.db.select().from(levelProgress).all()).toEqual([]);
      expect(ctx.db.select().from(skillProgress).all()).toEqual([]);
      expect(ctx.db.select().from(badges).all()).toEqual([]);
      expect(ctx.db.select().from(attempts).all()).toEqual([]);
      const [after] = ctx.db.select().from(users).where(eq(users.id, user.id)).all();
      expect(after).toMatchObject({ xp: 0, streakDays: 0, displayName: 'Keeper' });
      expect(ctx.db.select().from(spellbookNotes).all()).toHaveLength(1);
      const progress = ProgressResponseSchema.parse(
        (await ctx.app.inject({ method: 'GET', url: '/api/progress', headers: { cookie } })).json(),
      );
      expect(progress.totals).toMatchObject({
        xp: 0,
        completions: 0,
        levelsCompleted: 0,
        hintsUsed: 0,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects anonymous callers', async () => {
    const ctx = await makeTestContext(tree);
    try {
      expect((await ctx.app.inject({ method: 'DELETE', url: '/api/progress' })).statusCode).toBe(
        401,
      );
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('GET /api/daily', () => {
  it('returns a deterministic level with completion state', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const first = DailyResponseSchema.parse(
        (await ctx.app.inject({ method: 'GET', url: '/api/daily', headers: { cookie } })).json(),
      );
      const second = DailyResponseSchema.parse(
        (await ctx.app.inject({ method: 'GET', url: '/api/daily', headers: { cookie } })).json(),
      );
      expect(first.levelId).toBe(second.levelId);
      expect(first.completed).toBe(false);
      expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('GET /api/review', () => {
  it('lists overdue skills with a replay level', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }
      ctx.db
        .insert(skillProgress)
        .values({
          userId: user.id,
          skillId: 'pwd',
          uses: 1,
          levelsUsedJson: '["w1-01-a"]',
          lastUsedAt: 1,
        })
        .run();
      ctx.db
        .insert(levelProgress)
        .values({ userId: user.id, levelId: 'w1-01-a', completions: 1 })
        .run();
      const body = ReviewResponseSchema.parse(
        (await ctx.app.inject({ method: 'GET', url: '/api/review', headers: { cookie } })).json(),
      );
      expect(body.due).toEqual([{ skillId: 'pwd', levelId: 'w1-01-a' }]);
    } finally {
      await ctx.cleanup();
    }
  });
});
