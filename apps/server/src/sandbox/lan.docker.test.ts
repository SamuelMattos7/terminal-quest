import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectOptions, DockerProvider } from './dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from './provider.js';

const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
const provider = new DockerProvider({ client: docker });
const handles: SandboxHandle[] = [];

async function create(
  sidecars: SandboxSpec['sidecars'],
  seed: number,
  profile: SandboxSpec['profile'],
) {
  const handle = await provider.create({
    attemptId: randomUUID(),
    userId: 'lan-tests',
    levelId: 'w3-11-curl-and-dns',
    image: 'tq-base',
    network: 'lan',
    profile,
    sidecars,
    seed,
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/home/player',
    env: {},
  });
  handles.push(handle);
  return handle;
}

const player = (handle: SandboxHandle, ...cmd: string[]) =>
  provider.exec(handle, cmd, { user: 'player' });

describe('attempt LAN on real Docker', () => {
  let web: SandboxHandle;
  let withDns: SandboxHandle;

  beforeAll(async () => {
    web = await create(['web'], 17, 'basic');
    withDns = await create(['web', 'dns', 'ssh'], 42, 'admin');
  }, 60_000);

  afterAll(async () => {
    await Promise.all(handles.map((handle) => provider.destroy(handle)));
  }, 60_000);

  it('places player and services on exactly one labeled internal bridge per attempt', async () => {
    expect(web.networkId).not.toBe(withDns.networkId);
    for (const handle of handles) {
      const network = await docker.getNetwork(handle.networkId!).inspect();
      expect(network).toMatchObject({
        Driver: 'bridge',
        Internal: true,
        EnableIPv6: false,
        Name: `tq-${handle.spec.attemptId}`,
        Labels: { 'tq.managed': 'true', 'tq.attempt': handle.spec.attemptId },
      });
      expect(network.Options?.['com.docker.network.bridge.gateway_mode_ipv4']).toBe('isolated');
      for (const id of [handle.id, ...Object.values(handle.sidecarIds!)]) {
        const info = await docker.getContainer(id).inspect();
        expect(Object.keys(info.NetworkSettings.Networks)).toEqual([network.Name]);
        expect(info.HostConfig.PortBindings ?? {}).toEqual({});
        expect(info.Mounts).toEqual([]);
      }
    }
  });

  it('supports web aliases, status headers, API, and the exercise DNS record', async () => {
    const status = await player(
      withDns,
      'curl',
      '--noproxy',
      '*',
      '-si',
      'http://web.penguin.corp/status',
    );
    expect(status).toMatchObject({ code: 0, timedOut: false });
    expect(status.stdout).toMatch(/x-penguin-service: intranet/i);
    expect(status.stdout).toContain('{"service":"intranet","status":"ok"}');
    const api = await player(
      web,
      'curl',
      '--noproxy',
      '*',
      '-fsS',
      'http://web.penguin.corp/api/users',
    );
    expect(JSON.parse(api.stdout)).toEqual([{ name: 'Tux', role: 'operator' }]);
    const missing = await player(
      web,
      'curl',
      '--noproxy',
      '*',
      '-si',
      'http://web.penguin.corp/missing',
    );
    expect(missing.stdout).toMatch(/^HTTP\/1\.1 404/);
    expect(missing.stdout).toContain('{"error":"not found"}');
    const page = await player(web, 'curl', '--noproxy', '*', '-fsS', 'http://web.penguin.corp/');
    expect(page.stdout).toContain('Penguin Corp Intranet');
    const db = await player(
      withDns,
      'dig',
      '+short',
      '+time=1',
      '+tries=1',
      'db.penguin.corp',
      'A',
    );
    expect(db).toMatchObject({ code: 0, stdout: '192.0.2.43\n', timedOut: false });
    const direct = await player(
      withDns,
      'dig',
      '@dns.penguin.corp',
      '+short',
      'db.penguin.corp',
      'A',
    );
    expect(direct.stdout).toBe(db.stdout);
  });

  it.each(['web-only basic', 'web plus DNS admin'] as const)(
    'blocks literal IPv4/IPv6 internet traffic and public DNS from the player (%s)',
    async (scenario) => {
      const handle = scenario === 'web-only basic' ? web : withDns;
      expect(await player(handle, 'id', '-u')).toMatchObject({ code: 0, stdout: '1000\n' });
      for (const [ipVersion, address, urlHost] of [
        ['-4', '1.1.1.1', '1.1.1.1'],
        ['-6', '2606:4700:4700::1111', '[2606:4700:4700::1111]'],
      ] as const) {
        const route = await player(handle, 'ip', ipVersion, 'route', 'get', address);
        expect(route.code, `public ${ipVersion} route`).toBe(2);
        const request = await player(
          handle,
          'curl',
          ipVersion,
          '--noproxy',
          '*',
          '-ksS',
          '--max-time',
          '2',
          `https://${urlHost}/`,
        );
        expect(request, `literal ${ipVersion} HTTPS from player`).toMatchObject({
          code: 7,
          timedOut: false,
        });
      }
      for (const resolver of [[], ['@127.0.0.11'], ['@1.1.1.1']]) {
        const result = await player(
          handle,
          'dig',
          ...resolver,
          '+short',
          '+time=1',
          '+tries=1',
          'example.com',
          'A',
        );
        expect(result.timedOut).toBe(false);
        expect(result.stdout).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/m);
      }
    },
    20_000,
  );

  it('blocks a reachable service on another attempt LAN by its numeric address', async () => {
    const info = await docker.getContainer(withDns.sidecarIds!.web!).inspect();
    const remote = Object.values(info.NetworkSettings.Networks)[0]!.IPAddress;
    const url = `http://${remote}/status`;
    expect(await player(withDns, 'curl', '--noproxy', '*', '-fsS', url)).toMatchObject({ code: 0 });
    expect(
      await player(web, 'curl', '--noproxy', '*', '-sS', '--max-time', '2', url),
    ).toMatchObject({
      code: 7,
      timedOut: false,
    });
  });

  it('exposes SSH only as a public-key service before level setup adds a key', async () => {
    const login = await player(
      withDns,
      'ssh',
      '-F',
      '/dev/null',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=3',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'deploy@ssh.penguin.corp',
      'hostname',
    );
    expect(login).toMatchObject({ code: 255, timedOut: false });
    expect(login.stderr).toContain('Permission denied (publickey)');
  });

  it('removes the player, sidecars and bridge, and tolerates a repeated destroy', async () => {
    await provider.destroy(withDns);
    await provider.destroy(withDns);
    for (const id of [withDns.id, ...Object.values(withDns.sidecarIds!)]) {
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({ statusCode: 404 });
    }
    await expect(docker.getNetwork(withDns.networkId!).inspect()).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await provider.listManaged()).some((m) => m.attemptId === withDns.spec.attemptId)).toBe(
      false,
    );
  });
});
