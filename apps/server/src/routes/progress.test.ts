import { describe, expect, it } from 'vitest';
import {
  ProgressResponseSchema,
  ReviewResponseSchema,
  SkillsResponseSchema,
  SpellbookResponseSchema,
  DailyResponseSchema,
} from '@terminal-quest/shared';
import { levelProgress, skillProgress, users } from '../db/schema.js';
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
      expect(body.totals).toMatchObject({ xp: 60, completions: 2, levelsCompleted: 1 });
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
