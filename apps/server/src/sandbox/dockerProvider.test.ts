import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DockerProvider } from './dockerProvider.js';
import { CapacityError, SessionManager } from './sessionManager.js';
import type { DockerClient, SandboxSpec } from './provider.js';
import { loadConfig } from '../config.js';

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

function setup(overrides?: { image?: string | undefined; runtime?: string | undefined }) {
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
  const provider = new DockerProvider({ client, ...overrides });
  const manager = new SessionManager({ provider, maxContainers: 1, idleTtlMs: 100, maxAgeMs: 200 });
  return { stream, exec, container, provider, manager, client };
}

describe('Docker sandbox configuration', () => {
  it.each(['basic', 'admin'] as const)(
    'uses a per-container PID cap without a shared-UID nproc budget (%s)',
    async (profile) => {
      const { provider, client } = setup();
      await provider.create({ ...spec, profile, resources: { ...spec.resources, pids: 32 } });
      expect(client.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            PidsLimit: 32,
            Ulimits: [
              { Name: 'nofile', Soft: 1024, Hard: 1024 },
              { Name: 'core', Soft: 0, Hard: 0 },
            ],
          }),
        }),
      );
    },
  );
  it('rejects LAN networks and sidecars before acquiring a container (T9.1)', async () => {
    const { provider, client } = setup();
    await expect(provider.create({ ...spec, network: 'lan' })).rejects.toThrow('T10.2');
    await expect(provider.create({ ...spec, sidecars: ['web'] })).rejects.toThrow('T10.2');
    expect(client.createContainer).not.toHaveBeenCalled();
  });
  it('passes validated image and runtime overrides without changing isolation', async () => {
    const config = loadConfig({
      SANDBOX_IMAGE: 'registry.example:5000/tq/base:release',
      SANDBOX_RUNTIME: 'io.containerd.runsc.v1',
    });
    const { provider, client } = setup({
      image: config.SANDBOX_IMAGE,
      runtime: config.SANDBOX_RUNTIME,
    });
    await provider.create(spec);
    expect(client.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: config.SANDBOX_IMAGE,
        HostConfig: expect.objectContaining({
          Runtime: config.SANDBOX_RUNTIME,
          CapDrop: ['ALL'],
          NetworkMode: 'none',
          SecurityOpt: ['no-new-privileges'],
        }),
      }),
    );
  });

  it('uses the level image and Docker default runtime without overrides', async () => {
    const { provider, client } = setup();
    await provider.create({ ...spec, image: 'tq-custom' });
    expect(client.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'tq-custom',
        HostConfig: expect.not.objectContaining({ Runtime: expect.anything() }),
      }),
    );
  });
});

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

describe('admin capability mapping (T10.1)', () => {
  it('adds only declared optional capabilities, keeps resource/network isolation', async () => {
    const { provider, client } = setup();
    await provider.create({ ...spec, profile: 'admin', capabilities: ['NET_RAW', 'NET_RAW'] });
    expect(client.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          CapDrop: ['ALL'],
          CapAdd: [
            'CHOWN',
            'DAC_OVERRIDE',
            'FOWNER',
            'SETUID',
            'SETGID',
            'KILL',
            'AUDIT_WRITE',
            'SYS_CHROOT',
            'NET_BIND_SERVICE',
            'NET_RAW',
          ],
          SecurityOpt: [],
          NetworkMode: 'none',
          PidsLimit: 128,
          Memory: 268435456,
        }),
      }),
    );
  });
  it('rejects undeclared authority before acquiring a container', async () => {
    const { provider, client } = setup();
    await expect(provider.create({ ...spec, capabilities: ['NET_RAW'] })).rejects.toThrow('admin');
    // Runtime callers outside TypeScript must also fail closed.
    const invalid = {
      ...spec,
      profile: 'admin',
      capabilities: ['SYS_ADMIN'],
    } as unknown as SandboxSpec;
    await expect(provider.create(invalid)).rejects.toThrow();
    expect(client.createContainer).not.toHaveBeenCalled();
  });
});
