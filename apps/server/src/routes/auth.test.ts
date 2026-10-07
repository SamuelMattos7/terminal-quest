import { describe, expect, it } from 'vitest';
import { GuestResponseSchema, MeResponseSchema } from '@terminal-quest/shared';
import { guestCookie, makeTestContext } from '../testUtils.js';

describe('POST /api/guest', () => {
  it('creates a guest and sets an httpOnly session cookie', async () => {
    const ctx = await makeTestContext();
    try {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/guest' });
      expect(res.statusCode).toBe(200);
      const body = GuestResponseSchema.parse(res.json());
      expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
      const setCookie = res.headers['set-cookie'];
      expect(String(setCookie)).toContain('tq_session=');
      expect(String(setCookie)).toContain('HttpOnly');
    } finally {
      ctx.cleanup();
    }
  });

  it('is idempotent with a valid cookie', async () => {
    const ctx = await makeTestContext();
    try {
      const cookie = await guestCookie(ctx.app);
      const first = await ctx.app.inject({
        method: 'POST',
        url: '/api/guest',
        headers: { cookie },
      });
      const second = await ctx.app.inject({
        method: 'POST',
        url: '/api/guest',
        headers: { cookie },
      });
      expect(GuestResponseSchema.parse(first.json()).user.id).toBe(
        GuestResponseSchema.parse(second.json()).user.id,
      );
    } finally {
      ctx.cleanup();
    }
  });
});

describe('GET /api/me', () => {
  it('rejects requests without a session', async () => {
    const ctx = await makeTestContext();
    try {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/me' });
      expect(res.statusCode).toBe(401);
    } finally {
      ctx.cleanup();
    }
  });

  it('returns user, player level, xp to next, and badges', async () => {
    const ctx = await makeTestContext();
    try {
      const cookie = await guestCookie(ctx.app);
      const res = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(MeResponseSchema.parse(res.json())).toEqual({
        user: expect.objectContaining({ xp: 0, streakDays: 0 }),
        playerLevel: 1,
        xpToNext: 100,
        badges: [],
      });
    } finally {
      ctx.cleanup();
    }
  });
});
