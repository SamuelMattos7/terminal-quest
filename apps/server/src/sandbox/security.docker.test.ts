import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectOptions } from './dockerProvider.js';
import {
  openSandbox,
  closeSandbox,
  baseCtx,
  type SandboxFixture,
} from '../engine/sandboxFixture.js';
import { loadLevels } from '../engine/levelLoader.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';
import { rootShell } from '../engine/checks/context.js';

describe('release sandbox security (T9.1)', () => {
  let fixture: SandboxFixture | undefined;
  const checkPath = '/opt/tq/checks/w2-15-boss-log-detective/verify-report.sh';

  beforeAll(async () => {
    fixture = await openSandbox('t9-1-security');
    const content = loadLevels(
      fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url)),
    );
    const level = content.byId.get('w2-15-boss-log-detective');
    const dir = content.levelDirs.get('w2-15-boss-log-detective');
    if (!level || !dir) throw new Error('missing release boss');
    await runSetup(fixture.provider, fixture.handle, compileSetup(level, dir, 7), 7);
  });

  afterAll(async () => {
    if (fixture) await closeSandbox(fixture);
  });

  it('keeps restrictive Docker flags, no mounts/devices/ports, and kernel resource limits', async () => {
    const { handle, provider } = fixture!;
    const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
    const info = await docker.getContainer(handle.id).inspect();
    expect(info.Config.User).toBe('player');
    expect(info.HostConfig).toMatchObject({
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL'],
      Memory: 268435456,
      MemorySwap: 268435456,
      NanoCpus: 500000000,
      PidsLimit: 128,
      NetworkMode: 'none',
      Privileged: false,
      SecurityOpt: ['no-new-privileges'],
      Tmpfs: { '/tmp': 'size=32m,noexec,nosuid' },
      Ulimits: expect.arrayContaining([
        { Name: 'nofile', Soft: 1024, Hard: 1024 },
        { Name: 'nproc', Soft: 128, Hard: 128 },
        { Name: 'core', Soft: 0, Hard: 0 },
      ]),
    });
    expect(info.Mounts).toEqual([]);
    expect(info.HostConfig.Binds ?? []).toEqual([]);
    expect(info.HostConfig.Devices ?? []).toEqual([]);
    expect(info.HostConfig.PortBindings ?? {}).toEqual({});
    const kernel = await provider.exec(
      handle,
      [
        'bash',
        '-c',
        'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max',
      ],
      { user: 'player' },
    );
    expect(kernel.code).toBe(0);
    expect(kernel.stdout.trim().split('\n')).toEqual(['268435456', '128', '50000 100000']);
  });

  it('gives player zero effective caps, prevents privilege escalation and socket access', async () => {
    const { handle, provider } = fixture!;
    const status = await provider.exec(
      handle,
      [
        'bash',
        '-c',
        'grep -E "^(CapEff|NoNewPrivs):" /proc/self/status; test ! -e /var/run/docker.sock && test ! -e /run/docker.sock',
      ],
      { user: 'player' },
    );
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/CapEff:\s+0000000000000000/);
    expect(status.stdout).toMatch(/NoNewPrivs:\s+1/);
    expect(
      (await provider.exec(handle, ['sudo', '-n', 'id', '-u'], { user: 'player' })).code,
    ).not.toBe(0);
    expect((await provider.exec(handle, ['su', '-c', 'id -u'], { user: 'player' })).code).not.toBe(
      0,
    );
  });

  it('protects root-owned checks/helpers and seeded answers from player writes and reads', async () => {
    const { handle, provider } = fixture!;
    const owners = await provider.exec(handle, [
      'stat',
      '-c',
      '%u:%g:%a',
      checkPath,
      '/opt/tq/secret',
      '/opt/tq/secret/ip',
    ]);
    expect(owners.code).toBe(0);
    expect(owners.stdout.trim().split('\n')).toEqual(['0:0:755', '0:0:700', '0:0:600']);
    for (const path of [
      '/opt/tq',
      '/opt/tq/bin',
      '/opt/tq/bashrc',
      '/opt/tq/bin/tux',
      checkPath,
      '/opt/tq/secret',
    ]) {
      expect(
        (await provider.exec(handle, ['test', '-w', path], { user: 'player' })).code,
        path,
      ).not.toBe(0);
    }
    expect(
      (await provider.exec(handle, ['cat', '/opt/tq/secret/ip'], { user: 'player' })).code,
    ).not.toBe(0);
    expect(
      (
        await provider.exec(handle, ['bash', '-c', `printf tampered > ${checkPath}`], {
          user: 'player',
        })
      ).code,
    ).not.toBe(0);
  });

  it('runs probes as root with a clean fixed environment and does not source player rc files', async () => {
    const { handle, provider } = fixture!;
    await provider.putFiles(handle, [
      {
        path: '/home/player/.bashrc',
        content: Buffer.from('echo PLAYER_RC_SOURCED\n'),
        mode: 0o644,
        uid: 1000,
        gid: 1000,
      },
    ]);
    const result = await rootShell(
      provider,
      handle,
      'id -u; printf "%s\\n" "$PATH" "$HOME" "$TQ_SEED"; env | cut -d= -f1 | sort',
      baseCtx(),
    );
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe(
      '0\n/usr/bin:/bin:/opt/tq/bin\n/root\n7\nHOME\nPATH\nPWD\nSHLVL\nTQ_SEED\n_\n',
    );
  });
});
