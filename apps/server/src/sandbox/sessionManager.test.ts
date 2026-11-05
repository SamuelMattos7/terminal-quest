import { describe, expect, it, vi } from 'vitest';
import type {
  ExecResult,
  ManagedSandbox,
  PutFilesEntry,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
  ShellStream,
} from './provider.js';
import { CapacityError, SessionManager } from './sessionManager.js';
import { deferred } from '../testUtils.js';
import { Reaper, REAPER_INTERVAL_MS } from './reaper.js';
import { logger } from '../util/logger.js';

// In-memory fake: no Docker needed. Destroyed ids are recorded so tests
// can assert expiry actually tore the sandbox down.
class FakeProvider implements SandboxProvider {
  created = 0;
  destroyed: string[] = [];
  orphanIds: string[] = [];

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    this.created += 1;
    return { id: `container-${this.created}`, spec };
  }

  async putFiles(_h: SandboxHandle, _entries: PutFilesEntry[]): Promise<void> {}

  async exec(): Promise<ExecResult> {
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  }

  async openShell(): Promise<ShellStream> {
    throw new Error('not implemented in FakeProvider');
  }

  async watchFile(): Promise<{ stop(): void }> {
    return { stop: () => undefined };
  }

  async destroy(h: SandboxHandle): Promise<void> {
    this.destroyed.push(h.id);
  }

  async listManaged(): Promise<ManagedSandbox[]> {
    return this.orphanIds.map((attemptId, i) => ({
      containerId: `orphan-${i}`,
      attemptId,
      createdAt: 0,
    }));
  }
}

const baseSpec: SandboxSpec = {
  attemptId: 'attempt-1',
  userId: 'user-1',
  levelId: 'w1-01-first-words',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

function setup(maxContainers = 2) {
  const provider = new FakeProvider();
  let now = 1_000_000;
  const manager = new SessionManager({
    provider,
    maxContainers,
    idleTtlMs: 60_000,
    maxAgeMs: 600_000,
    now: () => now,
  });
  return { provider, manager, advance: (ms: number) => (now += ms) };
}

describe('SessionManager', () => {
  it('creates sessions and tracks them', async () => {
    const { manager } = setup();
    const s = await manager.create(baseSpec);
    expect(manager.size).toBe(1);
    expect(manager.get(s.id)?.handle.spec.attemptId).toBe('attempt-1');
  });

  it('throws CapacityError at the cap', async () => {
    const { manager } = setup(1);
    await manager.create(baseSpec);
    await expect(manager.create(baseSpec)).rejects.toThrow(CapacityError);
    expect(manager.size).toBe(1);
  });

  it('reserves capacity while container creation is pending', async () => {
    const { provider, manager } = setup(1);
    const gate = deferred<SandboxHandle>();
    const create = vi.spyOn(provider, 'create').mockReturnValueOnce(gate.promise);
    const first = manager.create(baseSpec);
    try {
      await expect(manager.create({ ...baseSpec, userId: 'user-2' })).rejects.toThrow(
        CapacityError,
      );
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve({ id: 'container-1', spec: baseSpec });
      await first;
    }
    expect(manager.size).toBe(1);
  });

  it('releases the capacity reservation when container creation fails', async () => {
    const { provider, manager } = setup(1);
    vi.spyOn(provider, 'create').mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(manager.create(baseSpec)).rejects.toThrow('Docker unavailable');
    await manager.create(baseSpec);
    expect(manager.size).toBe(1);
  });

  it('expires idle sessions with a fake clock and destroys the sandbox', async () => {
    const { provider, manager, advance } = setup();
    const s = await manager.create(baseSpec);
    advance(59_999);
    expect(await manager.sweepOnce()).toEqual({ idle: 0, maxAge: 0 });
    expect(manager.get(s.id)).toBeDefined();
    advance(1);
    expect(await manager.sweepOnce()).toEqual({ idle: 1, maxAge: 0 });
    expect(manager.get(s.id)).toBeUndefined();
    expect(provider.destroyed).toContain(s.handle.id);
  });

  it('touch restarts the idle clock', async () => {
    const { manager, advance } = setup();
    const s = await manager.create(baseSpec);
    advance(59_999);
    manager.touch(s.id);
    advance(59_999);
    expect(await manager.sweepOnce()).toEqual({ idle: 0, maxAge: 0 });
    expect(manager.get(s.id)).toBeDefined();
  });

  it('expires sessions at max age even when recently touched', async () => {
    const { provider, manager, advance } = setup();
    const s = await manager.create(baseSpec);
    advance(599_999);
    manager.touch(s.id);
    advance(1);
    expect(await manager.sweepOnce()).toEqual({ idle: 0, maxAge: 1 });
    expect(provider.destroyed).toContain(s.handle.id);
  });

  it('close(manual) destroys and forgets; unknown ids are no-ops', async () => {
    const { provider, manager } = setup();
    const s = await manager.create(baseSpec);
    await manager.close(s.id, 'manual');
    expect(manager.size).toBe(0);
    expect(provider.destroyed).toContain(s.handle.id);
    await manager.close('nope', 'manual');
    manager.touch('nope');
    expect(manager.get('nope')).toBeUndefined();
  });

  it('sweepOrphans destroys only containers without a live session', async () => {
    const { provider, manager } = setup();
    const live = await manager.create({ ...baseSpec, attemptId: 'live-attempt' });
    provider.orphanIds = ['live-attempt', 'ghost-1', 'ghost-2'];
    expect(await manager.sweepOrphans()).toBe(2);
    expect(provider.destroyed).toContain('orphan-1');
    expect(provider.destroyed).toContain('orphan-2');
    expect(provider.destroyed).not.toContain(live.handle.id);
  });

  it('retains failed manual teardown capacity and retries on the next sweep (A05)', async () => {
    const { provider, manager } = setup(1);
    const session = await manager.create(baseSpec);
    const destroy = vi.spyOn(provider, 'destroy').mockRejectedValueOnce(new Error('Docker down'));
    await expect(manager.close(session.id, 'manual')).rejects.toThrow('Docker down');
    expect(manager.get(session.id)).toBeUndefined();
    expect(manager.size).toBe(1);
    await expect(manager.create(baseSpec)).rejects.toThrow(CapacityError);
    await manager.sweepOnce();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(manager.size).toBe(0);
    await manager.create(baseSpec);
  });

  it('shares in-flight teardown between close and overlapping sweeps (A05)', async () => {
    const { provider, manager } = setup(1);
    const session = await manager.create(baseSpec);
    const entered = deferred();
    const gate = deferred();
    const destroy = vi.spyOn(provider, 'destroy').mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
    });
    const closing = manager.close(session.id, 'manual');
    await entered.promise;
    try {
      expect(manager.get(session.id)).toBeUndefined();
      expect(manager.size).toBe(1);
      await expect(manager.create(baseSpec)).rejects.toThrow(CapacityError);
      const retry = manager.close(session.id, 'manual');
      const sweep = manager.sweepOnce();
      expect(destroy).toHaveBeenCalledTimes(1);
      gate.resolve();
      await Promise.all([closing, retry, sweep]);
      expect(manager.size).toBe(0);
    } finally {
      gate.resolve();
      await closing;
    }
  });

  it.each(['idle', 'max_age'] as const)(
    'invalidates %s immediately, continues sweeping after failure, and notifies once (A05)',
    async (reason) => {
      const provider = new FakeProvider();
      const expired = vi.fn();
      const manager = new SessionManager({
        provider,
        maxContainers: 2,
        idleTtlMs: 100,
        maxAgeMs: 200,
        now: () => 0,
        onExpire: expired,
      });
      const first = await manager.create(baseSpec);
      const second = await manager.create(baseSpec);
      vi.spyOn(provider, 'destroy').mockRejectedValueOnce(new Error('Docker down'));
      await expect(manager.sweepOnce(reason === 'idle' ? 100 : 200)).rejects.toThrow();
      expect(manager.get(first.id)).toBeUndefined();
      expect(manager.get(second.id)).toBeUndefined();
      expect(expired.mock.calls).toEqual([
        [first.id, reason],
        [second.id, reason],
      ]);
      expect(manager.size).toBe(1);
      await manager.sweepOnce(0);
      expect(manager.size).toBe(0);
      expect(expired).toHaveBeenCalledTimes(2);
    },
  );

  it('retains failed boot orphan cleanup for periodic retry without another listing (A05)', async () => {
    const { provider, manager } = setup(1);
    provider.orphanIds = ['ghost-1', 'ghost-2'];
    const destroy = vi.spyOn(provider, 'destroy').mockRejectedValueOnce(new Error('Docker down'));
    await expect(manager.sweepOrphans()).rejects.toThrow();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(manager.size).toBe(1);
    provider.orphanIds = [];
    await manager.sweepOnce();
    expect(destroy).toHaveBeenCalledTimes(3);
    expect(manager.size).toBe(0);
  });

  it('keeps retrying teardown across failed periodic reaper ticks (A05)', async () => {
    vi.useFakeTimers();
    const { provider, manager } = setup(1);
    const reaper = new Reaper(manager, logger);
    try {
      await reaper.start();
      const session = await manager.create(baseSpec);
      const destroy = vi
        .spyOn(provider, 'destroy')
        .mockRejectedValueOnce(new Error('Docker down'))
        .mockRejectedValueOnce(new Error('Docker still down'));
      await expect(manager.close(session.id, 'manual')).rejects.toThrow('Docker down');
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(manager.get(session.id)).toBeUndefined();
      expect(manager.size).toBe(1);
      await expect(manager.create(baseSpec)).rejects.toThrow(CapacityError);
      await vi.advanceTimersByTimeAsync(REAPER_INTERVAL_MS);
      expect(destroy).toHaveBeenCalledTimes(3);
      expect(manager.size).toBe(0);
    } finally {
      reaper.stop();
      vi.useRealTimers();
    }
  });

  it('notifies each expiry once when two sweeps overlap (A05)', async () => {
    const provider = new FakeProvider();
    const expired = vi.fn();
    const manager = new SessionManager({
      provider,
      maxContainers: 2,
      idleTtlMs: 100,
      maxAgeMs: 200,
      now: () => 0,
      onExpire: expired,
    });
    const first = await manager.create(baseSpec);
    const second = await manager.create(baseSpec);
    const entered = deferred();
    const gate = deferred();
    const destroy = vi.spyOn(provider, 'destroy').mockImplementationOnce(async () => {
      entered.resolve();
      await gate.promise;
    });
    const one = manager.sweepOnce(200);
    await entered.promise;
    const two = manager.sweepOnce(200);
    try {
      gate.resolve();
      await Promise.all([one, two]);
      expect(expired.mock.calls).toEqual([
        [first.id, 'max_age'],
        [second.id, 'max_age'],
      ]);
      expect(destroy).toHaveBeenCalledTimes(2);
    } finally {
      gate.resolve();
      await Promise.allSettled([one, two]);
    }
  });
});
