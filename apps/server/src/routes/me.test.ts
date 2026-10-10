import { describe, expect, it } from 'vitest';
import { GuestResponseSchema } from '@terminal-quest/shared';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

const tree = [makeLevel('a', 1, 1)];

describe('PATCH /api/me', () => {
  it('updates the display name and returns the user', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { cookie, 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: '  Tux Fan  ' }),
      });
      expect(res.statusCode).toBe(200);
      expect(GuestResponseSchema.parse(res.json()).user.displayName).toBe('Tux Fan');
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects blank and over-long names', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      for (const displayName of ['   ', 'x'.repeat(41)]) {
        const res = await ctx.app.inject({
          method: 'PATCH',
          url: '/api/me',
          headers: { cookie, 'content-type': 'application/json' },
          payload: JSON.stringify({ displayName }),
        });
        expect(res.statusCode).toBe(400);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects anonymous callers', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: '/api/me',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ displayName: 'Tux' }),
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });
});
