import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerProvider, connectOptions } from './dockerProvider.js';
import type { SandboxHandle } from './provider.js';
import { loadLevels } from '../engine/levelLoader.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';

const levels = loadLevels(
  fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url)),
);
const level = levels.byId.get('w3-01-sudo-and-id')!;
const levelDir = levels.levelDirs.get(level.id)!;
const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
const handles: SandboxHandle[] = [];

async function create(capabilities: ('NET_RAW' | 'NET_ADMIN')[] = []) {
  const handle = await provider.create({
    attemptId: `t10-1-${Date.now()}-${handles.length}`,
    userId: 'admin-test',
    levelId: level.id,
    image: 'tq-base',
    profile: 'admin',
    capabilities,
    network: 'none',
    sidecars: [],
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/home/player',
    env: {},
  });
  handles.push(handle);
  return handle;
}

async function player(handle: SandboxHandle, command: string[]) {
  return provider.exec(handle, command, { user: 'player', timeoutMs: 5000 });
}

describe('admin sandbox boundaries (T10.1)', () => {
  let handle: SandboxHandle;
  beforeAll(async () => {
    handle = await create();
    const cronLevel = {
      ...level,
      setup: {
        ...level.setup,
        dirs: level.setup?.dirs ?? [],
        files: level.setup?.files ?? [],
        generators: level.setup?.generators ?? [],
        commands: [
          "printf '%s\\n' '@reboot /usr/bin/touch /home/player/cron-fired' | crontab -u player -",
        ],
      },
    };
    await runSetup(provider, handle, compileSetup(cronLevel, levelDir, 1), 1);
  });
  afterAll(async () => {
    const results = await Promise.allSettled(handles.map((h) => provider.destroy(h)));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  });

  it('permits the declared root-only read and id without elevating the interactive user', async () => {
    expect((await player(handle, ['cat', '/root/access-code.txt'])).code).not.toBe(0);
    const allowed = await player(handle, ['sudo', '-n', 'cat', '/root/access-code.txt']);
    const expected = await provider.exec(handle, ['cat', '/opt/tq/secret/access_code'], {
      user: 'root',
    });
    expect(allowed.code).toBe(0);
    expect(allowed.stdout).toBe(expected.stdout);
    expect((await player(handle, ['sudo', '-n', 'id', '-u'])).stdout.trim()).toBe('0');
    expect((await player(handle, ['id', '-u'])).stdout.trim()).toBe('1000');
    expect((await player(handle, ['sudo', '-n', '-l'])).stdout).toContain(
      '/usr/bin/cat /root/access-code.txt',
    );
  });

  it('denies root shells, unrelated reads, su and sudoers writes', async () => {
    for (const cmd of [
      ['sudo', '-n', 'bash', '-c', 'id'],
      ['sudo', '-n', 'cat', '/etc/shadow'],
      ['sudo', '-n', 'cat', '/root/access-code.txt', '/etc/shadow'],
      ['su', '-c', 'id'],
      ['sh', '-c', 'echo bad >> /etc/sudoers.d/tq'],
    ])
      expect((await player(handle, cmd)).code, cmd.join(' ')).not.toBe(0);
    const result = await provider.exec(handle, ['stat', '-c', '%a:%u:%g', '/etc/sudoers.d/tq'], {
      user: 'root',
    });
    expect(result.stdout.trim()).toBe('440:0:0');
  });

  it('supports default user and ownership administration without adding mount authority', async () => {
    expect((await player(handle, ['sudo', '-n', 'useradd', '-m', 'deploy'])).code).toBe(0);
    const user = await provider.exec(handle, ['id', '-un', 'deploy'], { user: 'root' });
    expect(user.stdout.trim()).toBe('deploy');
    expect(
      (await player(handle, ['sudo', '-n', 'chown', 'deploy:deploy', '/home/deploy'])).code,
    ).toBe(0);
    expect((await player(handle, ['sudo', '-n', 'chmod', '750', '/home/deploy'])).code).toBe(0);
    const mode = await provider.exec(handle, ['stat', '-c', '%U:%a', '/home/deploy'], {
      user: 'root',
    });
    expect(mode.stdout.trim()).toBe('deploy:750');
    expect(
      (await player(handle, ['sudo', '-n', 'mount', '-t', 'tmpfs', 'tmpfs', '/mnt'])).code,
    ).not.toBe(0);
  });

  it('starts real cron and executes its job as player', async () => {
    expect((await provider.exec(handle, ['pgrep', '-x', 'cron'], { user: 'root' })).code).toBe(0);
    await expect
      .poll(
        async () =>
          (
            await provider.exec(handle, ['stat', '-c', '%U', '/home/player/cron-fired'], {
              user: 'root',
            })
          ).stdout.trim(),
        { timeout: 10_000 },
      )
      .toBe('player');
  });

  it('keeps default capabilities and isolation, with NET_RAW/NET_ADMIN opt-in only', async () => {
    const base = await docker.getContainer(handle.id).inspect();
    expect(base.HostConfig.CapAdd).not.toContain('NET_RAW');
    expect(base.HostConfig.CapAdd).not.toContain('NET_ADMIN');
    expect(base.HostConfig).toMatchObject({
      CapDrop: ['ALL'],
      NetworkMode: 'none',
      Privileged: false,
      PidsLimit: 128,
      Memory: 268435456,
      NanoCpus: 500000000,
    });
    expect(base.Mounts).toEqual([]);
    const caps = await provider.exec(handle, ['awk', '/CapBnd/ {print $2}', '/proc/self/status'], {
      user: 'root',
    });
    const mask = BigInt(`0x${caps.stdout.trim()}`);
    expect(mask & ((1n << 12n) | (1n << 13n))).toBe(0n);
    const extra = await create(['NET_RAW', 'NET_ADMIN']);
    const enabled = await provider.exec(
      extra,
      ['awk', '/CapBnd/ {print $2}', '/proc/self/status'],
      { user: 'root' },
    );
    expect(BigInt(`0x${enabled.stdout.trim()}`) & ((1n << 12n) | (1n << 13n))).toBe(
      (1n << 12n) | (1n << 13n),
    );
  });

  it('honors needs_cron false while keeping sudo usable', async () => {
    const quiet = await create();
    await runSetup(
      provider,
      quiet,
      compileSetup({ ...level, sandbox: { ...level.sandbox, needs_cron: false } }, levelDir, 2),
      2,
    );
    expect((await provider.exec(quiet, ['pgrep', '-x', 'cron'], { user: 'root' })).code).toBe(1);
    expect((await player(quiet, ['sudo', '-n', 'id', '-u'])).stdout.trim()).toBe('0');
  });
});
