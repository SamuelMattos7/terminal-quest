import { describe, expect, it, vi } from 'vitest';
import { GuestResponseSchema, MeResponseSchema } from '@terminal-quest/shared';
import { users } from '../db/schema.js';
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
      expect(String(setCookie)).not.toContain('; Secure');
    } finally {
      await ctx.cleanup();
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
      await ctx.cleanup();
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
      await ctx.cleanup();
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
      await ctx.cleanup();
    }
  });

  it('expires the displayed streak at UTC midnight after a missed day', async () => {
    const ctx = await makeTestContext();
    try {
      const cookie = await guestCookie(ctx.app);
      ctx.db.update(users).set({ lastActiveDay: '2026-10-31', streakDays: 7 }).run();
      const now = vi.spyOn(Date, 'now');
      const readStreak = async () => {
        const res = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
        expect(res.statusCode).toBe(200);
        return MeResponseSchema.parse(res.json()).user.streakDays;
      };
      now.mockReturnValue(Date.parse('2026-10-31T23:59:59Z'));
      expect(await readStreak()).toBe(7);
      now.mockReturnValue(Date.parse('2026-11-01T23:59:59Z'));
      expect(await readStreak()).toBe(7);
      now.mockReturnValue(Date.parse('2026-11-02T00:00:00Z'));
      expect(await readStreak()).toBe(0);
      expect(ctx.db.select().from(users).get()).toMatchObject({
        lastActiveDay: '2026-10-31',
        streakDays: 7,
      });
    } finally {
      vi.restoreAllMocks();
      await ctx.cleanup();
    }
  });
});
