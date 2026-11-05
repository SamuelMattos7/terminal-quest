import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DockerProvider } from './dockerProvider.js';
import { CapacityError, SessionManager } from './sessionManager.js';
import type { DockerClient, SandboxSpec } from './provider.js';

const spec: SandboxSpec = {
  attemptId: 'a05',
  userId: 'user',
  levelId: 'level',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

function setup() {
  const stream = new PassThrough();
  const exec = { start: vi.fn(async () => stream), resize: vi.fn(async () => undefined) };
  const container = {
    id: 'container',
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    exec: vi.fn(async () => exec),
    modem: { demuxStream: vi.fn() },
  };
  const client = {
    createContainer: vi.fn(async () => container),
    getContainer: vi.fn(() => container),
  } as unknown as DockerClient;
  const provider = new DockerProvider({ client });
  const manager = new SessionManager({ provider, maxContainers: 1, idleTtlMs: 100, maxAgeMs: 200 });
  return { stream, exec, container, provider, manager };
}

describe('Docker resource acquisition cleanup (A05)', () => {
  it('immediately removes a container whose start failed and preserves the start error', async () => {
    const ctx = setup();
    const failure = new Error('start failed');
    ctx.container.start.mockRejectedValueOnce(failure);
    await expect(ctx.manager.create(spec)).rejects.toBe(failure);
    expect(ctx.container.remove).toHaveBeenCalledWith({ force: true, v: true });
    expect(ctx.manager.size).toBe(0);
    await ctx.manager.create(spec);
  });

  it('retains a failed-start container when immediate cleanup fails and reaps it later', async () => {
    const ctx = setup();
    ctx.container.start.mockRejectedValueOnce(new Error('start failed'));
    ctx.container.remove.mockRejectedValueOnce(new Error('remove failed'));
    await expect(ctx.manager.create(spec)).rejects.toThrow('start failed');
    expect(ctx.manager.size).toBe(1);
    await expect(ctx.manager.create(spec)).rejects.toThrow(CapacityError);
    await ctx.manager.sweepOnce();
    expect(ctx.container.remove).toHaveBeenCalledTimes(2);
    expect(ctx.manager.size).toBe(0);
    await ctx.manager.create(spec);
  });

  it('closes the acquired shell stream when initial resize fails', async () => {
    const ctx = setup();
    ctx.exec.resize.mockRejectedValueOnce(new Error('resize failed'));
    await expect(
      ctx.provider.openShell({ id: 'container', spec }, { cols: 80, rows: 24 }),
    ).rejects.toThrow('resize failed');
    expect(ctx.stream.destroyed).toBe(true);
  });

  it('closes the acquired watcher stream when demultiplexing fails', async () => {
    const ctx = setup();
    ctx.container.modem.demuxStream.mockImplementationOnce(() => {
      throw new Error('demux failed');
    });
    await expect(
      ctx.provider.watchFile({ id: 'container', spec }, '/run/tq/inbox', vi.fn()),
    ).rejects.toThrow('demux failed');
    expect(ctx.stream.destroyed).toBe(true);
  });
});

describe('Docker shell and watcher failures (A14)', () => {
  it('keeps shell output that arrives during initial resize (A16)', async () => {
    const ctx = setup();
    const greeting = Buffer.from('Welcome 🐧');
    ctx.exec.resize.mockImplementationOnce(async () => {
      ctx.stream.write(greeting);
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const shell = await ctx.provider.openShell({ id: 'container', spec }, { cols: 80, rows: 24 });
    try {
      const onData = vi.fn();
      shell.onData(onData);
      await vi.waitFor(() => expect(onData).toHaveBeenCalledWith(greeting));
    } finally {
      shell.close();
    }
  });

  it('returns a rejected resize to the caller and leaves the shell available', async () => {
    const ctx = setup();
    const shell = await ctx.provider.openShell({ id: 'container', spec }, { cols: 80, rows: 24 });
    const failure = new Error('resize failed');
    ctx.exec.resize.mockRejectedValueOnce(failure);
    try {
      await expect(shell.resize(90, 30)).rejects.toBe(failure);
      await expect(shell.resize(100, 40)).resolves.toBeUndefined();
      expect(ctx.exec.resize).toHaveBeenLastCalledWith({ h: 40, w: 100 });
    } finally {
      shell.close();
    }
  });

  it('observes shell errors before startup completes', async () => {
    const ctx = setup();
    const failure = new Error('shell transport failed during startup');
    ctx.exec.resize.mockImplementationOnce(async () => {
      ctx.stream.emit('error', failure);
    });
    await expect(
      ctx.provider.openShell({ id: 'container', spec }, { cols: 80, rows: 24 }),
    ).rejects.toBe(failure);
    expect(ctx.stream.destroyed).toBe(true);
  });

  it('reports a shell stream error once and replays it to a late close subscriber', async () => {
    const ctx = setup();
    const shell = await ctx.provider.openShell({ id: 'container', spec }, { cols: 80, rows: 24 });
    const onClose = vi.fn();
    shell.onClose(onClose);
    const failure = new Error('shell transport failed');
    const closed = new Promise<void>((resolve) => ctx.stream.once('close', resolve));
    ctx.stream.destroy(failure);
    await closed;
    expect(onClose.mock.calls).toEqual([[failure]]);
    const late = vi.fn();
    shell.onClose(late);
    expect(late.mock.calls).toEqual([[failure]]);
  });

  it.each(['unexpected', 'requested'])('reports only %s watcher closure', async (kind) => {
    const ctx = setup();
    const onError = vi.fn();
    const watcher = await ctx.provider.watchFile(
      { id: 'container', spec },
      '/run/tq/inbox',
      vi.fn(),
      onError,
    );
    const closed = once(ctx.stream, 'close');
    if (kind === 'unexpected') ctx.stream.destroy();
    else watcher.stop();
    await closed;
    if (kind === 'unexpected') {
      expect(onError.mock.calls).toEqual([
        [expect.objectContaining({ message: 'file watcher closed unexpectedly' })],
      ]);
    } else expect(onError).not.toHaveBeenCalled();
  });
});
