import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attempts, events } from '../db/schema.js';
import { deferred, guestCookie, makeTestContext } from '../testUtils.js';
import { logger } from '../util/logger.js';

afterEach(() => vi.restoreAllMocks());

async function setup(maxContainers = 1) {
  const ctx = await makeTestContext(undefined, { MAX_CONTAINERS: maxContainers });
  const { app } = ctx;
  vi.spyOn(app.provider, 'create').mockImplementation(async (spec) => ({ id: randomUUID(), spec }));
  const put = vi.spyOn(app.provider, 'putFiles').mockResolvedValue();
  vi.spyOn(app.provider, 'exec').mockResolvedValue({
    code: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  });
  const shell = {
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(),
    onClose: vi.fn(),
    close: vi.fn(),
  };
  const open = vi.spyOn(app.provider, 'openShell').mockResolvedValue(shell);
  const stops: ReturnType<typeof vi.fn>[] = [];
  const watch = vi.spyOn(app.provider, 'watchFile').mockImplementation(async () => {
    const stop = vi.fn();
    stops.push(stop);
    return { stop };
  });
  const destroy = vi.spyOn(app.provider, 'destroy').mockResolvedValue();
  const cookie = await guestCookie(app);
  const start = () =>
    app.inject({
      method: 'POST',
      url: '/api/levels/w1-01-first/start',
      headers: { cookie },
    });
  return { ...ctx, put, shell, open, watch, stops, destroy, cookie, start };
}

describe('launch and teardown cleanup (A05)', () => {
  it.each(['setup', 'attempt', 'shell', 'inbox', 'cmdlog', 'event'] as const)(
    'unwinds a failed %s stage and permits the next launch',
    async (stage) => {
      const ctx = await setup();
      const inboxStop = vi.fn();
      try {
        if (stage === 'setup') ctx.put.mockRejectedValueOnce(new Error('setup unavailable'));
        if (stage === 'attempt')
          ctx.db.$client.exec(
            "CREATE TRIGGER fail_launch BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT, 'attempt unavailable'); END",
          );
        if (stage === 'shell') ctx.open.mockRejectedValueOnce(new Error('shell unavailable'));
        if (stage === 'inbox') ctx.watch.mockRejectedValueOnce(new Error('inbox unavailable'));
        if (stage === 'cmdlog')
          ctx.watch
            .mockResolvedValueOnce({ stop: inboxStop })
            .mockRejectedValueOnce(new Error('cmdlog unavailable'));
        if (stage === 'event')
          ctx.db.$client.exec(
            "CREATE TRIGGER fail_launch BEFORE INSERT ON events WHEN NEW.type = 'level_start' BEGIN SELECT RAISE(ABORT, 'event unavailable'); END",
          );
        expect((await ctx.start()).statusCode).toBe(500);
        expect(ctx.app.live.size).toBe(0);
        expect(ctx.app.manager.size).toBe(0);
        expect(ctx.destroy).toHaveBeenCalledTimes(1);
        const rows = ctx.db.select().from(attempts).all();
        expect(rows).toHaveLength(['setup', 'attempt'].includes(stage) ? 0 : 1);
        expect(rows.every((row) => row.status === 'abandoned' && row.endedAt !== null)).toBe(true);
        if (['inbox', 'cmdlog', 'event'].includes(stage))
          expect(ctx.shell.close).toHaveBeenCalledTimes(1);
        if (stage === 'cmdlog') expect(inboxStop).toHaveBeenCalledTimes(1);
        if (stage === 'event') for (const stop of ctx.stops) expect(stop).toHaveBeenCalledTimes(1);
        if (['attempt', 'event'].includes(stage)) ctx.db.$client.exec('DROP TRIGGER fail_launch');
        expect((await ctx.start()).statusCode).toBe(200);
      } finally {
        ctx.db.$client.exec('DROP TRIGGER IF EXISTS fail_launch');
        await ctx.cleanup();
      }
    },
  );

  it('preserves the launch error when destruction fails and retries before releasing capacity', async () => {
    const ctx = await setup();
    try {
      ctx.open.mockRejectedValueOnce(new Error('shell unavailable'));
      ctx.destroy.mockRejectedValueOnce(new Error('destroy unavailable'));
      const failed = await ctx.start();
      expect(failed.json()).toMatchObject({ message: 'shell unavailable' });
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.app.manager.size).toBe(1);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
      expect((await ctx.start()).statusCode).toBe(429);
      await ctx.app.manager.sweepOnce();
      expect(ctx.destroy).toHaveBeenCalledTimes(2);
      expect((await ctx.start()).statusCode).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });

  it.each(['manual', 'expiry', 'shutdown'] as const)(
    'stops both watchers and the shell during %s teardown',
    async (action) => {
      const ctx = await setup();
      try {
        expect((await ctx.start()).statusCode).toBe(200);
        const live = [...ctx.app.live.values()][0]!;
        if (action === 'manual') {
          await ctx.app.inject({
            method: 'DELETE',
            url: `/api/sessions/${live.session.id}`,
            headers: { cookie: ctx.cookie },
          });
        } else if (action === 'expiry') {
          await ctx.app.manager.sweepOnce(
            live.session.createdAt + ctx.app.config.MAX_AGE_SECONDS * 1000,
          );
        } else await ctx.app.close();
        expect(live.closed).toBe(true);
        expect(ctx.shell.close).toHaveBeenCalledTimes(1);
        expect(ctx.stops).toHaveLength(2);
        for (const stop of ctx.stops) expect(stop).toHaveBeenCalledTimes(1);
      } finally {
        await ctx.cleanup();
      }
    },
  );

  it('invalidates expiry and releases local resources even while destruction fails', async () => {
    const ctx = await setup();
    try {
      await ctx.start();
      const live = [...ctx.app.live.values()][0]!;
      ctx.destroy.mockRejectedValueOnce(new Error('Docker down'));
      await expect(
        ctx.app.manager.sweepOnce(live.session.createdAt + ctx.app.config.MAX_AGE_SECONDS * 1000),
      ).rejects.toThrow();
      expect(live.closed).toBe(true);
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('expired');
      for (const stop of ctx.stops) expect(stop).toHaveBeenCalledTimes(1);
      await ctx.app.manager.sweepOnce();
      expect(
        ctx.db
          .select()
          .from(events)
          .all()
          .filter((e) => e.type === 'level_abandon'),
      ).toHaveLength(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it('cleans resources acquired after launch was aborted by a watcher error', async () => {
    const ctx = await setup();
    const gate = deferred();
    const stop = vi.fn();
    ctx.watch.mockImplementationOnce(async (_h, _path, _onLine, onError) => {
      onError?.(new Error('watcher failed during startup'));
      await gate.promise;
      return { stop };
    });
    const pending = ctx.start();
    gate.resolve();
    try {
      expect((await pending).statusCode).toBe(500);
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.app.manager.size).toBe(0);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(ctx.shell.close).toHaveBeenCalledTimes(1);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
    } finally {
      gate.resolve();
      await pending;
      await ctx.cleanup();
    }
  });

  it('rejects a launch expired while acquiring a watcher and closes the late resource', async () => {
    const ctx = await setup();
    const entered = deferred();
    const gate = deferred();
    const stop = vi.fn();
    ctx.watch.mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
      return { stop };
    });
    const pending = ctx.start().then((res) => res);
    await entered.promise;
    try {
      await ctx.app.manager.sweepOnce(Date.now() + ctx.app.config.MAX_AGE_SECONDS * 1000);
      gate.resolve();
      expect((await pending).statusCode).toBe(500);
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.app.manager.size).toBe(0);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(ctx.shell.close).toHaveBeenCalledTimes(1);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
    } finally {
      gate.resolve();
      await pending;
      await ctx.cleanup();
    }
  });

  it('continues teardown when socket, watcher, and shell cleanup throw', async () => {
    const ctx = await setup();
    try {
      await ctx.start();
      const live = [...ctx.app.live.values()][0]!;
      const fail = () => {
        throw new Error('resource already broken');
      };
      const socket = { send: vi.fn(fail), close: vi.fn(fail) };
      live.socket = socket;
      ctx.stops[0]!.mockImplementationOnce(fail);
      ctx.shell.close.mockImplementationOnce(fail);
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/sessions/${live.session.id}`,
        headers: { cookie: ctx.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(socket.close).toHaveBeenCalledTimes(1);
      for (const stop of ctx.stops) expect(stop).toHaveBeenCalledTimes(1);
      expect(ctx.destroy).toHaveBeenCalledTimes(1);
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.app.manager.size).toBe(0);
      expect(ctx.db.select().from(attempts).get()?.status).toBe('abandoned');
    } finally {
      await ctx.cleanup();
    }
  });

  it('shutdown retries failed launches and failed live teardown', async () => {
    const ctx = await setup(2);
    try {
      ctx.open.mockRejectedValueOnce(new Error('shell unavailable'));
      ctx.destroy.mockRejectedValueOnce(new Error('Docker down'));
      expect((await ctx.start()).statusCode).toBe(500);
      expect((await ctx.start()).statusCode).toBe(200);
      ctx.destroy.mockRejectedValueOnce(new Error('Docker still down'));
      await ctx.app.close();
      expect(ctx.app.live.size).toBe(0);
      expect(ctx.app.manager.size).toBe(0);
      expect(ctx.destroy).toHaveBeenCalledTimes(4);
      expect(
        ctx.db
          .select()
          .from(attempts)
          .all()
          .every((row) => row.status === 'abandoned'),
      ).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });
});

it.each(['start', 'reset'] as const)(
  'logs setup failure during %s and returns a safe error (A14)',
  async (action) => {
    const ctx = await setup();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const old =
        action === 'reset' ? (await ctx.start()).json<{ sessionId: string }>() : undefined;
      vi.mocked(ctx.app.provider.exec).mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'private setup details',
        timedOut: false,
      });
      const response =
        old === undefined
          ? await ctx.start()
          : await ctx.app.inject({
              method: 'POST',
              url: `/api/sessions/${old.sessionId}/reset`,
              headers: { cookie: ctx.cookie },
            });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'level setup failed' });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'setup',
          levelId: 'w1-01-first',
          sessionId: expect.any(String),
          attemptId: expect.any(String),
          err: expect.objectContaining({
            message: expect.stringContaining('private setup details'),
          }),
        }),
        'session launch failed',
      );
    } finally {
      await ctx.cleanup();
    }
  },
);
