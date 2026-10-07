import { describe, expect, it } from 'vitest';
import { WorldsResponseSchema, type WorldsResponse } from '@terminal-quest/shared';
import { levelProgress, users } from '../db/schema.js';
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
      ctx.cleanup();
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
      ctx.cleanup();
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
      ctx.cleanup();
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
      ctx.cleanup();
    }
  });

  it('filters worlds by ENABLE_WORLDS', async () => {
    const ctx = await makeTestContext(tree, { ENABLE_WORLDS: [1] });
    try {
      const cookie = await guestCookie(ctx.app);
      const worlds = await getWorlds(ctx, cookie);
      expect(worlds.worlds.map((w) => w.id)).toEqual([1]);
    } finally {
      ctx.cleanup();
    }
  });
});
