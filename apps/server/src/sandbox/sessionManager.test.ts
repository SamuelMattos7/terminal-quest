import { describe, expect, it } from 'vitest';
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
});
