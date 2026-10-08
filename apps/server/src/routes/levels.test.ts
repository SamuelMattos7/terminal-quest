import { describe, expect, it } from 'vitest';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

const FORBIDDEN = ['check', 'setup', 'solutions', 'hints', 'from_file', 'secret'];

describe('GET /api/levels/:id', () => {
  it('returns the public DTO without answers or internals', async () => {
    const ctx = await makeTestContext([makeLevel('first', 1, 1)]);
    try {
      const cookie = await guestCookie(ctx.app);
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/levels/w1-01-first',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        [
          'hintCount',
          'id',
          'kind',
          'objectives',
          'parCommands',
          'story',
          'teaches',
          'title',
          'xp',
        ].sort(),
      );
      const leaked = JSON.stringify(body);
      for (const key of FORBIDDEN) {
        expect(leaked).not.toContain(`"${key}"`);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns 404 for unknown levels and 401 without a session', async () => {
    const ctx = await makeTestContext([makeLevel('first', 1, 1)]);
    try {
      const cookie = await guestCookie(ctx.app);
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/levels/w9-99-nope',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/levels/w1-01-first' })).statusCode,
      ).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });
});
