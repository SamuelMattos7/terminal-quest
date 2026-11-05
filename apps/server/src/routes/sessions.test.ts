import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartSessionResponseSchema } from '@terminal-quest/shared';
import { attempts } from '../db/schema.js';
import { deferred, guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

afterEach(() => vi.restoreAllMocks());

async function setup(maxContainers = 2) {
  const ctx = await makeTestContext([makeLevel('a', 1, 1)], { MAX_CONTAINERS: maxContainers });
  const provider = ctx.app.provider;
  const create = vi.spyOn(provider, 'create').mockImplementation(async (spec) => ({
    id: randomUUID(),
    spec,
  }));
  vi.spyOn(provider, 'putFiles').mockResolvedValue();
  vi.spyOn(provider, 'exec').mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  });
  vi.spyOn(provider, 'openShell').mockImplementation(async () => ({
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
  }));
  vi.spyOn(provider, 'watchFile').mockResolvedValue({ stop: vi.fn() });
  const destroy = vi.spyOn(provider, 'destroy').mockResolvedValue();
  // Observe the second request reaching its handler before releasing the
  // first create. No Docker or wall-clock delay is involved in the overlap.
  const arrived = deferred();
  let watchedUrl = '';
  ctx.app.addHook('preHandler', async (request) => {
    if (request.url === watchedUrl) arrived.resolve();
  });
  const cookie = await guestCookie(ctx.app);
  const start = (guest = cookie) =>
    ctx.app
      .inject({
        method: 'POST',
        url: '/api/levels/w1-01-a/start',
        headers: { cookie: guest },
      })
      .then((res) => res);
  return {
    ...ctx,
    cookie,
    create,
    destroy,
    start,
    async overlap(url: string, first: () => Promise<unknown>) {
      const entered = deferred();
      const gate = deferred();
      create.mockImplementationOnce(async (spec) => {
        entered.resolve();
        await gate.promise;
        return { id: randomUUID(), spec };
      });
      const pending = first();
      await entered.promise;
      watchedUrl = url;
      return { pending, gate, arrived: arrived.promise };
    },
  };
}

describe('session lifecycle concurrency (A01)', () => {
  it('serializes overlapping starts for the same user', async () => {
    const ctx = await setup(1);
    try {
      const overlap = await ctx.overlap('/api/levels/w1-01-a/start', () => ctx.start());
      const second = ctx.start();
      await overlap.arrived;
      await setImmediate();
      const createsBeforeRelease = ctx.create.mock.calls.length;
      overlap.gate.resolve();
      const [one, two] = await Promise.all([overlap.pending, second]);
      expect(createsBeforeRelease).toBe(1);
      expect(one).toMatchObject({ statusCode: 200 });
      expect(two.statusCode).toBe(200);
      expect(ctx.app.manager.size).toBe(1);
      expect(ctx.app.live.size).toBe(1);
      const id = StartSessionResponseSchema.parse(two.json()).sessionId;
      expect(ctx.app.live.get(id)).toBeDefined();
      expect(ctx.destroy).toHaveBeenCalledTimes(1);
      expect(
        ctx.db
          .select()
          .from(attempts)
          .all()
          .map((a) => a.status)
          .sort(),
      ).toEqual(['abandoned', 'active']);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects a different user while the last capacity slot is being created', async () => {
    const ctx = await setup(1);
    try {
      const guest = await guestCookie(ctx.app);
      const overlap = await ctx.overlap('/api/levels/w1-01-a/start', () => ctx.start());
      const second = ctx.start(guest);
      await overlap.arrived;
      await setImmediate();
      overlap.gate.resolve();
      const [one, two] = await Promise.all([overlap.pending, second]);
      expect(one).toMatchObject({ statusCode: 200 });
      expect(two.statusCode).toBe(429);
      expect(two.headers['retry-after']).toBe('30');
      expect(ctx.create).toHaveBeenCalledTimes(1);
      expect(ctx.app.manager.size).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it.each(['start', 'reset'] as const)(
    'serializes reset followed by overlapping %s',
    async (action) => {
      const ctx = await setup();
      try {
        const initial = StartSessionResponseSchema.parse((await ctx.start()).json());
        const resetUrl = `/api/sessions/${initial.sessionId}/reset`;
        const reset = () =>
          ctx.app
            .inject({
              method: 'POST',
              url: resetUrl,
              headers: { cookie: ctx.cookie },
            })
            .then((res) => res);
        const overlap = await ctx.overlap(
          action === 'start' ? '/api/levels/w1-01-a/start' : resetUrl,
          reset,
        );
        const second = action === 'start' ? ctx.start() : reset();
        await overlap.arrived;
        await setImmediate();
        const createsBeforeRelease = ctx.create.mock.calls.length;
        overlap.gate.resolve();
        const [one, two] = await Promise.all([overlap.pending, second]);
        expect(createsBeforeRelease).toBe(2);
        expect(one).toMatchObject({ statusCode: 200 });
        expect(two.statusCode).toBe(action === 'start' ? 200 : 404);
        expect(ctx.app.manager.size).toBe(1);
        expect(ctx.app.live.size).toBe(1);
        expect(
          ctx.db
            .select()
            .from(attempts)
            .all()
            .filter((a) => a.status === 'active'),
        ).toHaveLength(1);
      } finally {
        await ctx.cleanup();
      }
    },
  );

  it('releases user serialization and capacity after a failed launch', async () => {
    const ctx = await setup(1);
    try {
      ctx.create.mockRejectedValueOnce(new Error('Docker unavailable'));
      const [one, two] = await Promise.all([ctx.start(), ctx.start()]);
      expect(one.statusCode).toBe(500);
      expect(two.statusCode).toBe(200);
      expect(ctx.app.manager.size).toBe(1);
      expect(ctx.app.live.size).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it('allows a different user to launch while the first user is waiting on Docker', async () => {
    const ctx = await setup(2);
    try {
      const guest = await guestCookie(ctx.app);
      const overlap = await ctx.overlap('/api/levels/w1-01-a/start', () => ctx.start());
      try {
        expect((await ctx.start(guest)).statusCode).toBe(200);
        expect(ctx.app.live.size).toBe(1);
      } finally {
        overlap.gate.resolve();
        await overlap.pending;
      }
      expect(ctx.app.manager.size).toBe(2);
    } finally {
      await ctx.cleanup();
    }
  });

  it('revalidates the old session after an overlapping start replaces it', async () => {
    const ctx = await setup();
    try {
      const initial = StartSessionResponseSchema.parse((await ctx.start()).json());
      const url = `/api/sessions/${initial.sessionId}/reset`;
      const overlap = await ctx.overlap(url, () => ctx.start());
      const reset = ctx.app
        .inject({ method: 'POST', url, headers: { cookie: ctx.cookie } })
        .then((res) => res);
      await overlap.arrived;
      await setImmediate();
      overlap.gate.resolve();
      const [start, staleReset] = await Promise.all([overlap.pending, reset]);
      expect(start).toMatchObject({ statusCode: 200 });
      expect(staleReset.statusCode).toBe(404);
      expect(ctx.create).toHaveBeenCalledTimes(2);
      expect(ctx.app.manager.size).toBe(1);
      expect(ctx.app.live.size).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});

it('blocks reset of a session whose world was disabled with UNLOCK_ALL enabled (A10)', async () => {
  const ctx = await setup();
  try {
    ctx.app.config.UNLOCK_ALL = 1;
    const started = await ctx.start();
    expect(started.statusCode).toBe(200);
    const { sessionId } = StartSessionResponseSchema.parse(started.json());
    ctx.app.config.ENABLE_WORLDS.splice(0, 1);
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/reset`,
      headers: { cookie: ctx.cookie },
    });
    expect(reset.statusCode).toBe(404);
    expect(ctx.create).toHaveBeenCalledTimes(1);
    expect(ctx.app.live.get(sessionId)).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});
