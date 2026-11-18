import { describe, expect, it, vi } from 'vitest';
import { DockerProvider } from './dockerProvider.js';
import type { DockerClient, SandboxSpec } from './provider.js';
import { CapacityError, SessionManager } from './sessionManager.js';

const spec: SandboxSpec = {
  attemptId: 'lan-attempt',
  userId: 'player',
  levelId: 'w3-11-curl-and-dns',
  image: 'tq-base',
  profile: 'basic',
  network: 'lan',
  sidecars: ['web', 'dns'],
  seed: 7,
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

function mockDocker() {
  const removalOrder: string[] = [];
  const network = {
    id: 'network-id',
    remove: vi.fn(async () => {
      removalOrder.push('network');
    }),
  };
  const makeContainer = (id: string, ip: string) => ({
    id,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    remove: vi.fn(async () => {
      removalOrder.push(id);
    }),
    inspect: vi.fn(async () => ({
      State: { Running: true, Health: { Status: 'healthy' } },
      NetworkSettings: {
        Networks: { 'tq-lan-attempt': { NetworkID: network.id, IPAddress: ip } },
      },
    })),
  });
  const web = makeContainer('web-id', '172.19.0.2');
  const dns = makeContainer('dns-id', '172.19.0.3');
  const player = makeContainer('player-id', '172.19.0.4');
  const containers = new Map([web, dns, player].map((c) => [c.id, c]));
  const client = {
    createNetwork: vi.fn(async () => network),
    getNetwork: vi.fn(() => network),
    createContainer: vi
      .fn(() => Promise.resolve(player))
      .mockResolvedValueOnce(web)
      .mockResolvedValueOnce(dns),
    getContainer: vi.fn((id: string) => containers.get(id)!),
    listNetworks: vi.fn<() => Promise<unknown[]>>(),
    listContainers: vi.fn<() => Promise<unknown[]>>(),
  };
  const provider = new DockerProvider({ client: client as unknown as DockerClient });
  const manager = new SessionManager({ provider, maxContainers: 1, idleTtlMs: 100, maxAgeMs: 200 });
  return { client, provider, manager, network, web, dns, player, removalOrder };
}

describe('LAN resource ownership', () => {
  it('configures internal networking, aliases and a private DNS upstream when declared', async () => {
    const { client, provider } = mockDocker();
    const handle = await provider.create(spec);
    expect(handle).toMatchObject({
      id: 'player-id',
      networkId: 'network-id',
      sidecarIds: { web: 'web-id', dns: 'dns-id' },
    });
    expect(client.createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: 'tq-lan-attempt',
        Driver: 'bridge',
        Internal: true,
      }),
    );
    expect(client.createContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Image: 'tq-web',
        NetworkingConfig: { EndpointsConfig: { 'network-id': { Aliases: ['web.penguin.corp'] } } },
      }),
    );
    expect(client.createContainer).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        HostConfig: expect.objectContaining({ NetworkMode: 'network-id', Dns: ['172.19.0.3'] }),
      }),
    );
  });

  it('cleans up sidecars and network if sidecar startup fails before the player is created', async () => {
    const { client, provider, dns, removalOrder } = mockDocker();
    const failure = new Error('dns start failed');
    dns.start.mockRejectedValueOnce(failure);
    await expect(provider.create(spec)).rejects.toBe(failure);
    expect(client.createContainer).toHaveBeenCalledTimes(2);
    expect(removalOrder.slice(0, -1).sort()).toEqual(['dns-id', 'web-id']);
    expect(removalOrder.at(-1)).toBe('network');
  });

  it('retains capacity for a network-only failed acquisition until cleanup succeeds', async () => {
    const { client, manager, network } = mockDocker();
    client.createContainer.mockReset().mockRejectedValueOnce(new Error('image unavailable'));
    network.remove.mockRejectedValueOnce(new Error('network busy'));
    await expect(manager.create(spec)).rejects.toThrow('image unavailable');
    expect(manager.size).toBe(1);
    await expect(manager.create(spec)).rejects.toThrow(CapacityError);
    expect(client.getContainer).not.toHaveBeenCalled();
    await manager.sweepOnce();
    expect(network.remove).toHaveBeenCalledTimes(2);
    expect(manager.size).toBe(0);
  });

  it('reaps a LAN whose player is gone and a crash that left only a network', async () => {
    const { client, manager, removalOrder } = mockDocker();
    const labels = (attempt: string) => ({ 'tq.managed': 'true', 'tq.attempt': attempt });
    client.listNetworks.mockResolvedValue([
      { Id: 'lan-with-sidecar', Labels: labels('old-a') },
      { Id: 'network-only', Labels: labels('old-b') },
    ]);
    client.listContainers.mockResolvedValue([
      {
        Id: 'web-id',
        Labels: { ...labels('old-a'), 'tq.network': 'lan-with-sidecar', 'tq.sidecar': 'web' },
      },
    ]);
    expect(await manager.sweepOrphans()).toBe(2);
    expect(client.listNetworks).toHaveBeenCalledWith({ filters: { label: ['tq.managed=true'] } });
    expect(client.getContainer.mock.calls).toEqual([['web-id']]);
    expect(client.getNetwork.mock.calls).toEqual([['lan-with-sidecar'], ['network-only']]);
    expect(removalOrder).toEqual(['web-id', 'network', 'network']);
  });

  it('does not reap a bridge while its sidecars are starting', async () => {
    const { client, manager, network, web } = mockDocker();
    let finishStartup!: () => void;
    web.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStartup = resolve;
        }),
    );
    client.listNetworks.mockResolvedValue([
      { Id: network.id, Labels: { 'tq.attempt': spec.attemptId } },
    ]);
    client.listContainers.mockResolvedValue([]);
    const pending = manager.create(spec);
    await vi.waitFor(() => expect(finishStartup).toBeTypeOf('function'));
    try {
      expect(await manager.sweepOrphans()).toBe(0);
      expect(network.remove).not.toHaveBeenCalled();
    } finally {
      finishStartup();
      await pending;
      await manager.closeAll();
    }
  });
});
