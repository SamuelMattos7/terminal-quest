import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartSessionResponseSchema } from '@terminal-quest/shared';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';
import { buildHostConfig } from '../sandbox/profiles.js';

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const ctx = await makeTestContext([makeLevel('a', 1, 1)], { MAX_CONTAINERS: 2 });
  const create = vi.spyOn(ctx.app.provider, 'create').mockImplementation(async (spec) => {
    buildHostConfig(spec);
    return { id: randomUUID(), spec };
  });
  vi.spyOn(ctx.app.provider, 'putFiles').mockResolvedValue();
  vi.spyOn(ctx.app.provider, 'exec').mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  });
  vi.spyOn(ctx.app.provider, 'openShell').mockResolvedValue({
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
  });
  vi.spyOn(ctx.app.provider, 'watchFile').mockResolvedValue({ stop: vi.fn() });
  const destroy = vi.spyOn(ctx.app.provider, 'destroy').mockResolvedValue();
  const cookie = await guestCookie(ctx.app);
  const start = () =>
    ctx.app.inject({ method: 'POST', url: '/api/levels/w1-01-a/start', headers: { cookie } });
  return { ...ctx, create, destroy, cookie, start };
}

describe('session security (T9.1)', () => {
  it.each(['lan', 'sidecars'] as const)(
    'rejects unsupported %s level configuration without silently degrading (T9.1)',
    async (feature) => {
      const ctx = await setup();
      try {
        const level = ctx.app.levels.byId.get('w1-01-a')!;
        if (feature === 'lan') level.sandbox.network = 'lan';
        else level.sandbox.sidecars = ['web'];
        expect((await ctx.start()).statusCode).toBe(500);
        expect(ctx.app.live.size).toBe(0);
        expect(ctx.app.manager.size).toBe(0);
        expect(ctx.app.provider.putFiles).not.toHaveBeenCalled();
      } finally {
        await ctx.cleanup();
      }
    },
  );
  it('limits starts by authenticated user across IPs without sharing a NAT budget', async () => {
    const ctx = await setup();
    try {
      const other = await guestCookie(ctx.app);
      const start = (cookie: string, remoteAddress: string) =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/levels/w1-01-a/start',
          headers: { cookie },
          remoteAddress,
        });
      for (let i = 0; i < 10; i++) {
        expect((await start(ctx.cookie, '192.0.2.1')).statusCode).toBe(200);
      }
      expect((await start(other, '192.0.2.1')).statusCode).toBe(200);
      const denied = await start(ctx.cookie, '192.0.2.2');
      expect(denied.statusCode).toBe(429);
      expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
      expect(ctx.create).toHaveBeenCalledTimes(11);
    } finally {
      await ctx.cleanup();
    }
  });

  it('counts starts toward the general IP limit', async () => {
    const ctx = await setup();
    try {
      for (let i = 0; i < 59; i++) {
        expect(
          (await ctx.app.inject({ url: '/healthz', remoteAddress: '192.0.2.3' })).statusCode,
        ).toBe(200);
      }
      const start = () =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/levels/w1-01-a/start',
          headers: { cookie: ctx.cookie },
          remoteAddress: '192.0.2.3',
        });
      expect((await start()).statusCode).toBe(200);
      expect((await start()).statusCode).toBe(429);
      expect(ctx.create).toHaveBeenCalledTimes(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rate-limits resets before replacing the live sandbox', async () => {
    const ctx = await setup();
    try {
      let id = StartSessionResponseSchema.parse((await ctx.start()).json()).sessionId;
      for (let i = 0; i < 10; i++) {
        const res = await ctx.app.inject({
          method: 'POST',
          url: `/api/sessions/${id}/reset`,
          headers: { cookie: ctx.cookie },
        });
        expect(res.statusCode).toBe(200);
        id = StartSessionResponseSchema.parse(res.json()).sessionId;
      }
      const denied = await ctx.app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/reset`,
        headers: { cookie: ctx.cookie },
      });
      expect(denied.statusCode).toBe(429);
      expect(ctx.app.live.get(id)).toBeDefined();
      expect(ctx.create).toHaveBeenCalledTimes(11);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects foreign and unauthenticated reset/delete without touching the owner session', async () => {
    const ctx = await setup();
    try {
      const other = await guestCookie(ctx.app);
      const id = StartSessionResponseSchema.parse((await ctx.start()).json()).sessionId;
      for (const method of ['POST', 'DELETE'] as const) {
        const url = `/api/sessions/${id}${method === 'POST' ? '/reset' : ''}`;
        expect((await ctx.app.inject({ method, url, headers: { cookie: other } })).statusCode).toBe(
          403,
        );
        expect((await ctx.app.inject({ method, url })).statusCode).toBe(401);
      }
      expect(ctx.app.live.get(id)).toBeDefined();
      expect(ctx.destroy).not.toHaveBeenCalled();
    } finally {
      await ctx.cleanup();
    }
  });
});
