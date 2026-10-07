import { describe, expect, it } from 'vitest';
import { StartSessionResponseSchema } from '@terminal-quest/shared';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

const tree = [makeLevel('a', 1, 1), makeLevel('b', 1, 2)];

describe('POST /api/levels/:id/start', () => {
  it('starts a session and returns its socket path', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/levels/w1-01-a/start',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = StartSessionResponseSchema.parse(res.json());
      expect(body.wsPath).toBe(`/ws/sessions/${body.sessionId}`);
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${body.sessionId}`,
        headers: { cookie },
      });
    } finally {
      ctx.cleanup();
    }
  });

  it('rejects unknown levels, locked levels, and strangers', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w9-99-nope/start',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-02-b/start',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await ctx.app.inject({ method: 'POST', url: '/api/levels/w1-01-a/start' })).statusCode,
      ).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });

  it('returns 429 with Retry-After at capacity', async () => {
    const ctx = await makeTestContext(tree, { MAX_CONTAINERS: 1 });
    try {
      const first = await guestCookie(ctx.app);
      const second = await guestCookie(ctx.app);
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-a/start',
            headers: { cookie: first },
          })
        ).statusCode,
      ).toBe(200);
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/levels/w1-01-a/start',
        headers: { cookie: second },
      });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('30');
    } finally {
      ctx.cleanup();
    }
  });

  it('replaces the previous session of the same user', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const one = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-a/start',
            headers: { cookie },
          })
        ).json(),
      );
      const two = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-a/start',
            headers: { cookie },
          })
        ).json(),
      );
      expect(two.sessionId).not.toBe(one.sessionId);
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: `/api/sessions/${one.sessionId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${two.sessionId}`,
        headers: { cookie },
      });
    } finally {
      ctx.cleanup();
    }
  });
});

describe('POST /api/sessions/:id/reset', () => {
  it('hands out a new session and retires the old id', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const one = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-a/start',
            headers: { cookie },
          })
        ).json(),
      );
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/sessions/${one.sessionId}/reset`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const two = StartSessionResponseSchema.parse(res.json());
      expect(two.sessionId).not.toBe(one.sessionId);
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/sessions/${one.sessionId}/reset`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${two.sessionId}`,
        headers: { cookie },
      });
    } finally {
      ctx.cleanup();
    }
  });
});

describe('DELETE /api/sessions/:id', () => {
  it('abandons owned sessions, 404s unknown, 403s foreign ones', async () => {
    const ctx = await makeTestContext(tree);
    try {
      const cookie = await guestCookie(ctx.app);
      const other = await guestCookie(ctx.app);
      const one = StartSessionResponseSchema.parse(
        (
          await ctx.app.inject({
            method: 'POST',
            url: '/api/levels/w1-01-a/start',
            headers: { cookie },
          })
        ).json(),
      );
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: `/api/sessions/${one.sessionId}`,
            headers: { cookie: other },
          })
        ).statusCode,
      ).toBe(403);
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${one.sessionId}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: `/api/sessions/${one.sessionId}`,
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      ctx.cleanup();
    }
  });
});
