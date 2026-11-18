import { setTimeout as sleep } from 'node:timers/promises';
import { isIPv4 } from 'node:net';
import type Docker from 'dockerode';
import type { SandboxSidecar } from '@terminal-quest/shared';
import { buildLabels, NO_NEW_PRIVILEGES_OPT } from './profiles.js';
import type { DockerClient, SandboxHandle } from './provider.js';

const sidecars = {
  web: { image: 'tq-web', alias: 'web.penguin.corp', caps: [] },
  ssh: {
    image: 'tq-ssh',
    alias: 'ssh.penguin.corp',
    caps: [
      'CHOWN',
      'DAC_OVERRIDE',
      'SETUID',
      'SETGID',
      'SYS_CHROOT',
      'NET_BIND_SERVICE',
      'KILL',
      'AUDIT_WRITE',
    ],
  },
  dns: {
    image: 'tq-dns',
    alias: 'dns.penguin.corp',
    caps: ['NET_BIND_SERVICE', 'SETUID', 'SETGID'],
  },
} satisfies Record<SandboxSidecar, { image: string; alias: string; caps: string[] }>;

// No DNS sidecar means no upstream. An explicitly configured loopback
// resolver is scoped to the container, so Docker cannot use the host's DNS.
export const NO_UPSTREAM_DNS = '127.0.0.1';

export async function startLan(
  docker: DockerClient,
  handle: SandboxHandle,
  runtime?: string,
): Promise<{ id: string; dns: string }> {
  const { spec } = handle;
  const labels = buildLabels(spec);
  const network = await docker.createNetwork({
    Name: `tq-${spec.attemptId}`,
    Driver: 'bridge',
    Internal: true,
    EnableIPv6: false,
    Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' },
    Labels: labels,
  });
  handle.networkId = network.id;
  const ids: NonNullable<SandboxHandle['sidecarIds']> = {};
  handle.sidecarIds = ids;
  const endpoints: { name: SandboxSidecar; container: Docker.Container }[] = [];
  for (const name of spec.sidecars) {
    const definition = sidecars[name];
    const container = await docker.createContainer({
      Image: definition.image,
      ...(name === 'ssh' ? { Hostname: `ssh-${spec.seed ?? 0}` } : {}),
      Env: [`TQ_SEED=${spec.seed ?? 0}`],
      Labels: { ...labels, 'tq.network': network.id, 'tq.sidecar': name },
      HostConfig: {
        NetworkMode: network.id,
        Dns: [NO_UPSTREAM_DNS],
        CapDrop: ['ALL'],
        CapAdd: definition.caps,
        SecurityOpt: [NO_NEW_PRIVILEGES_OPT],
        Memory: 64 * 1024 * 1024,
        MemorySwap: 64 * 1024 * 1024,
        NanoCpus: 250_000_000,
        PidsLimit: 64,
        Ulimits: [
          { Name: 'core', Soft: 0, Hard: 0 },
          { Name: 'nofile', Soft: 1024, Hard: 1024 },
        ],
        Tmpfs: { '/tmp': 'size=8m,noexec,nosuid,mode=1777' },
        Init: true,
        ...(runtime === undefined ? {} : { Runtime: runtime }),
      },
      NetworkingConfig: {
        EndpointsConfig: { [network.id]: { Aliases: [definition.alias] } },
      },
    });
    ids[name] = container.id;
    await container.start();
    endpoints.push({ name, container });
  }
  let dns = NO_UPSTREAM_DNS;
  for (const { name, container } of endpoints) {
    const info = await waitForSidecar(container, name);
    if (name === 'dns') {
      const endpoint = Object.values(info.NetworkSettings.Networks).find(
        (endpoint) => endpoint.NetworkID === network.id,
      );
      if (!endpoint || !isIPv4(endpoint.IPAddress)) throw new Error('dns sidecar has no LAN IPv4');
      dns = endpoint.IPAddress;
    }
  }
  return { id: network.id, dns };
}

async function waitForSidecar(container: Docker.Container, name: SandboxSidecar) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const info = await container.inspect();
    const status = info.State.Health?.Status;
    if (status === 'healthy') return info;
    if (!info.State.Running || status !== 'starting') {
      const detail = info.State.Health?.Log.at(-1)?.Output.trim();
      throw new Error(
        `${name} sidecar failed to start (${status ?? info.State.Status})${detail ? `: ${detail}` : ''}`,
      );
    }
    await sleep(200);
  }
  throw new Error(`${name} sidecar readiness timed out`);
}
