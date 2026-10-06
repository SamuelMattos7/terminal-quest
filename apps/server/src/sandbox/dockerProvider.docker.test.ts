import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectOptions, DockerProvider } from './dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from './provider.js';

// T1.2 acceptance (requires Docker + `tq-base`): basic sandbox runs exec
// as player, has no network, carries resource limits, cleans up fully,
// and serves an interactive shell.

const spec: SandboxSpec = {
  attemptId: 't12-acceptance',
  userId: 't12-user',
  levelId: 'w1-01-first-words',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

/** Strip ANSI CSI/OSC escapes so assertions don't depend on PTY chunking. */
function stripAnsi(s: string): string {
  const esc = String.fromCharCode(27);
  const bel = String.fromCharCode(7);
  return s
    .replace(new RegExp(`${esc}\\][^${bel}]*${bel}`, 'g'), '')
    .replace(new RegExp(`${esc}\\[[0-9;?]*[a-zA-Z]`, 'g'), '');
}

describe('DockerProvider basic sandbox', () => {
  const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
  let h: SandboxHandle;

  beforeAll(async () => {
    h = await provider.create(spec);
  }, 60_000);

  afterAll(async () => {
    await provider.destroy(h);
  }, 60_000);

  it('runs exec as player (uid 1000)', async () => {
    const res = await provider.exec(h, ['id', '-u'], { user: 'player' });
    expect(res.timedOut).toBe(false);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('1000');
  }, 30_000);

  it('has no network access', async () => {
    const res = await provider.exec(h, ['curl', '-sS', '-m', '5', 'http://example.com'], {
      user: 'player',
      timeoutMs: 20_000,
    });
    expect(res.code).not.toBe(0);
  }, 30_000);

  it('carries the memory limit and managed labels', async () => {
    const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
    const info = await docker.getContainer(h.id).inspect();
    expect(info.HostConfig.Memory).toBe(256 * 1024 * 1024);
    expect(info.Config.Labels['tq.managed']).toBe('true');
    expect(info.Config.Labels['tq.attempt']).toBe(spec.attemptId);
    const managed = await provider.listManaged();
    expect(managed.map((m) => m.containerId)).toContain(h.id);
  }, 30_000);

  it('uploads files and reads them back as player', async () => {
    await provider.putFiles(h, [
      { path: '/home/player/hello.txt', content: Buffer.from('hi\n'), mode: 0o644 },
    ]);
    const res = await provider.exec(h, ['cat', '/home/player/hello.txt'], { user: 'player' });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('hi\n');
  }, 30_000);

  it('serves an interactive shell that echoes typed input', async () => {
    const shell = await provider.openShell(h, { cols: 80, rows: 24 });
    try {
      let output = '';
      shell.onData((chunk) => {
        output += chunk.toString('utf8');
      });
      shell.write('echo hi\n');
      const lines = (): string[] =>
        stripAnsi(output)
          .split('\n')
          .map((line) => line.trim());
      const deadline = Date.now() + 15_000;
      while (!lines().includes('hi') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(lines()).toContain('hi');
    } finally {
      shell.close();
    }
  }, 30_000);

  it('destroy leaves no container behind', async () => {
    const temp = await provider.create({ ...spec, attemptId: 't12-temp' });
    await provider.destroy(temp);
    const managed = await provider.listManaged();
    expect(managed.map((m) => m.containerId)).not.toContain(temp.id);
    const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
    await expect(docker.getContainer(temp.id).inspect()).rejects.toThrow();
  }, 60_000);
});
