import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { Reaper, REAPER_INTERVAL_MS } from './reaper.js';
import { SessionManager } from './sessionManager.js';
import type { SandboxProvider, SandboxSpec } from './provider.js';
import { deferred } from '../testUtils.js';

const spec: SandboxSpec = {
  attemptId: 'attempt',
  userId: 'user',
  levelId: 'w1-01-first-words',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

function setup() {
  const provider = {
    create: vi.fn<SandboxProvider['create']>().mockResolvedValue({ id: 'live', spec }),
    destroy: vi.fn<SandboxProvider['destroy']>().mockResolvedValue(undefined),
    listManaged: vi.fn<SandboxProvider['listManaged']>().mockResolvedValue([]),
    putFiles: vi.fn<SandboxProvider['putFiles']>(),
    exec: vi.fn<SandboxProvider['exec']>(),
    openShell: vi.fn<SandboxProvider['openShell']>(),
    watchFile: vi.fn<SandboxProvider['watchFile']>(),
  } satisfies SandboxProvider;
  const onExpire = vi.fn();
  const manager = new SessionManager({
    provider,
    maxContainers: 2,
    idleTtlMs: REAPER_INTERVAL_MS,
    maxAgeMs: 2 * REAPER_INTERVAL_MS,
    onExpire,
  });
  const logger = pino({ enabled: false });
  const error = vi.spyOn(logger, 'error');
  const reaper = new Reaper(manager, logger);
  return { provider, manager, onExpire, error, reaper };
}

describe('Reaper startup recovery (A06)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['idle', 'max_age'] as const)(
    'expires %s sessions created after Docker recovers from a failed boot listing',
    async (reason) => {
      const { provider, manager, onExpire, reaper } = setup();
      provider.listManaged.mockRejectedValueOnce(new Error('Docker unavailable'));
      try {
        await expect(reaper.start()).rejects.toThrow('Docker unavailable');
        expect(vi.getTimerCount()).toBe(1);
        const session = await manager.create(spec);
        if (reason === 'max_age') {
          await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS - 1);
          manager.touch(session.id);
          await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS - 1);
          manager.touch(session.id);
          await vi.advanceTimersByTimeAsync(2);
        } else {
          await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
        }
        expect(manager.get(session.id)).toBeUndefined();
        expect(manager.size).toBe(0);
        expect(provider.destroy.mock.calls).toEqual([[session.handle]]);
        expect(onExpire.mock.calls).toEqual([[session.id, reason]]);
      } finally {
        reaper.stop();
      }
    },
  );

  it('retries failed orphan discovery until recovery, then stops listing', async () => {
    const { provider, manager, error, reaper } = setup();
    provider.listManaged
      .mockRejectedValueOnce(new Error('Docker unavailable'))
      .mockRejectedValueOnce(new Error('Docker still unavailable'))
      .mockResolvedValue([{ containerId: 'orphan', attemptId: 'old', createdAt: 0 }]);
    try {
      await expect(reaper.start()).rejects.toThrow('Docker unavailable');
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(provider.listManaged).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(provider.destroy).toHaveBeenCalledWith(expect.objectContaining({ id: 'orphan' }));
      expect(manager.size).toBe(0);
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(provider.listManaged).toHaveBeenCalledTimes(3);
    } finally {
      reaper.stop();
    }
  });

  it('retries failed boot destruction across unavailable ticks and releases capacity', async () => {
    const { provider, manager, reaper } = setup();
    provider.listManaged.mockResolvedValueOnce([
      { containerId: 'orphan', attemptId: 'old', createdAt: 0 },
    ]);
    provider.destroy
      .mockRejectedValueOnce(new Error('Docker unavailable'))
      .mockRejectedValueOnce(new Error('Docker still unavailable'));
    try {
      await expect(reaper.start()).rejects.toThrow('orphan cleanup failed');
      expect(manager.size).toBe(1);
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(manager.size).toBe(1);
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(provider.destroy).toHaveBeenCalledTimes(3);
      expect(manager.size).toBe(0);
    } finally {
      reaper.stop();
    }
  });

  it('runs expiry while boot discovery is pending without overlapping discovery calls', async () => {
    const { provider, manager, reaper } = setup();
    const gate = deferred<Awaited<ReturnType<SandboxProvider['listManaged']>>>();
    provider.listManaged.mockReturnValueOnce(gate.promise);
    const starting = reaper.start();
    try {
      const session = await manager.create(spec);
      await vi.advanceTimersByTimeAsync(2 * REAPER_INTERVAL_MS);
      expect(manager.get(session.id)).toBeUndefined();
      expect(provider.listManaged).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve([]);
      await starting;
      reaper.stop();
    }
  });

  it('stops all periodic work after failed startup', async () => {
    const { provider, manager, reaper } = setup();
    provider.listManaged.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(reaper.start()).rejects.toThrow('Docker unavailable');
    const sweep = vi.spyOn(manager, 'sweepOnce');
    reaper.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3 * REAPER_INTERVAL_MS);
    expect(sweep).not.toHaveBeenCalled();
    expect(provider.listManaged).toHaveBeenCalledTimes(1);
  });

  it('keeps one timer on repeated starts after failure and stops while discovery is pending', async () => {
    const { provider, manager, reaper } = setup();
    const gate = deferred<Awaited<ReturnType<SandboxProvider['listManaged']>>>();
    provider.listManaged
      .mockRejectedValueOnce(new Error('Docker unavailable'))
      .mockReturnValueOnce(gate.promise);
    await expect(reaper.start()).rejects.toThrow('Docker unavailable');
    await reaper.start();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
    const sweep = vi.spyOn(manager, 'sweepOnce');
    reaper.stop();
    gate.resolve([]);
    await vi.advanceTimersByTimeAsync(2 * REAPER_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(0);
    expect(sweep).not.toHaveBeenCalled();
    expect(provider.listManaged).toHaveBeenCalledTimes(2);
  });
});
