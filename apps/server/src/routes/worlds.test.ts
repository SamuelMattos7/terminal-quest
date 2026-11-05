import { describe, expect, it, vi } from 'vitest';
import { WorldsResponseSchema, type WorldsResponse } from '@terminal-quest/shared';
import { levelProgress, skillProgress, users } from '../db/schema.js';
import { guestCookie, makeLevel, makeTestContext, type TestContext } from '../testUtils.js';

const tree = [
  makeLevel('a', 1, 1),
  makeLevel('b', 1, 2),
  makeLevel('boss', 1, 3, 'boss'),
  makeLevel('a', 2, 1),
];

async function getWorlds(ctx: TestContext, cookie: string): Promise<WorldsResponse> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/worlds', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return WorldsResponseSchema.parse(res.json());
}

function stateOf(worlds: WorldsResponse, id: string): string | undefined {
  return worlds.worlds.flatMap((w) => w.levels).find((l) => l.id === id)?.state;
}

function markDone(ctx: TestContext, userId: string, levelId: string): void {
  ctx.db
    .insert(levelProgress)
    .values({ userId, levelId, completions: 1, bestRank: 'A', bestXp: 50 })
    .run();
}

describe('GET /api/worlds', () => {
  it('requires a session', async () => {
    const ctx = await makeTestContext(tree);
    try {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/worlds' })).statusCode).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });

  it('walks the unlock chain: available, locked, boss gate, completed', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const [user] = ctx.db.select().from(users).all();
      if (user === undefined) {
        throw new Error('guest user missing');
      }

      let worlds = await getWorlds(ctx, cookie);
      expect(worlds.worlds.map((w) => w.id)).toEqual([1, 2]);
      expect(stateOf(worlds, 'w1-01-a')).toBe('available');
      expect(stateOf(worlds, 'w1-02-b')).toBe('locked');
      expect(stateOf(worlds, 'w2-01-a')).toBe('locked');

      markDone(ctx, user.id, 'w1-01-a');
      markDone(ctx, user.id, 'w1-02-b');
      worlds = await getWorlds(ctx, cookie);
      expect(stateOf(worlds, 'w1-02-b')).toBe('completed');
      expect(stateOf(worlds, 'w2-01-a')).toBe('locked');

      markDone(ctx, user.id, 'w1-03-boss');
      worlds = await getWorlds(ctx, cookie);
      expect(stateOf(worlds, 'w2-01-a')).toBe('available');
      expect(worlds.worlds.flatMap((w) => w.levels).find((l) => l.id === 'w1-01-a')?.bestRank).toBe(
        'A',
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('unlocks everything with UNLOCK_ALL', async () => {
    const ctx = await makeTestContext(tree, { UNLOCK_ALL: 1 });
    try {
      const cookie = await guestCookie(ctx.app);
      const worlds = await getWorlds(ctx, cookie);
      for (const level of worlds.worlds.flatMap((w) => w.levels)) {
        expect(level.state).toBe('available');
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects more than 60 requests per minute per IP', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      let last = 0;
      for (let i = 0; i < 61; i++) {
        last = (await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } }))
          .statusCode;
      }
      expect(last).toBe(429);
    } finally {
      await ctx.cleanup();
    }
  });

  it('filters worlds by ENABLE_WORLDS', async () => {
    const ctx = await makeTestContext(tree, { ENABLE_WORLDS: [1] });
    try {
      const cookie = await guestCookie(ctx.app);
      const worlds = await getWorlds(ctx, cookie);
      expect(worlds.worlds.map((w) => w.id)).toEqual([1]);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('disabled worlds (A10)', () => {
  it.each([[[]], [[1]]] as const)(
    'blocks level detail and start with UNLOCK_ALL and enabled worlds %j',
    async (enabledWorlds) => {
      const ctx = await makeTestContext(tree, { ENABLE_WORLDS: [...enabledWorlds], UNLOCK_ALL: 1 });
      const create = vi
        .spyOn(ctx.app.provider, 'create')
        .mockRejectedValue(new Error('unexpected sandbox'));
      try {
        const cookie = await guestCookie(ctx.app);
        const headers = { cookie };
        expect((await getWorlds(ctx, cookie)).worlds.map((world) => world.id)).toEqual(
          enabledWorlds,
        );
        const url = enabledWorlds.length === 0 ? '/api/levels/w1-01-a' : '/api/levels/w2-01-a';
        const detail = await ctx.app.inject({ method: 'GET', url, headers });
        const start = await ctx.app.inject({ method: 'POST', url: `${url}/start`, headers });
        expect([detail.statusCode, start.statusCode]).toEqual([404, 404]);
        expect(create).not.toHaveBeenCalled();
      } finally {
        await ctx.cleanup();
      }
    },
  );

  it('recommends only enabled levels for review, even with historical completions', async () => {
    const ctx = await makeTestContext(tree, { ENABLE_WORLDS: [2], UNLOCK_ALL: 1 });
    try {
      const cookie = await guestCookie(ctx.app);
      const user = ctx.db.select().from(users).get();
      if (user === undefined) throw new Error('guest user missing');
      markDone(ctx, user.id, 'w1-01-a');
      markDone(ctx, user.id, 'w2-01-a');
      ctx.db
        .insert(skillProgress)
        .values({ userId: user.id, skillId: 'pwd', uses: 1, lastUsedAt: 1 })
        .run();
      const review = await ctx.app.inject({
        method: 'GET',
        url: '/api/review',
        headers: { cookie },
      });
      expect(review.statusCode).toBe(200);
      expect(review.json()).toEqual({ due: [{ skillId: 'pwd', levelId: 'w2-01-a' }] });
    } finally {
      await ctx.cleanup();
    }
  });
});
