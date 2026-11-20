import { SandboxSidecarSchema } from '@terminal-quest/shared';
import type { DockerClient, ManagedSandbox, SandboxHandle } from './provider.js';

function statusCodeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'statusCode' in err
    ? err.statusCode
    : undefined;
}

async function removeContainer(docker: DockerClient, id: string): Promise<void> {
  const container = docker.getContainer(id);
  try {
    await container.stop({ t: 1 });
  } catch (err) {
    const code = statusCodeOf(err);
    if (code !== 304 && code !== 404) throw err;
  }
  try {
    await container.remove({ force: true, v: true });
  } catch (err) {
    if (statusCodeOf(err) !== 404) throw err;
  }
}

export async function destroyResources(docker: DockerClient, handle: SandboxHandle): Promise<void> {
  const ids = [handle.id, ...Object.values(handle.sidecarIds ?? {})].filter(Boolean);
  const results = await Promise.allSettled(ids.map((id) => removeContainer(docker, id)));
  const errors = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  if (errors.length) throw new AggregateError(errors, 'container cleanup failed');
  if (handle.networkId !== undefined) {
    try {
      await docker.getNetwork(handle.networkId).remove();
    } catch (err) {
      if (statusCodeOf(err) !== 404) throw err;
    }
  }
}

export async function discoverResources(docker: DockerClient): Promise<ManagedSandbox[]> {
  const filters = { label: ['tq.managed=true'] };
  const [containers, networks] = await Promise.all([
    docker.listContainers({ all: true, filters }),
    docker.listNetworks({ filters }),
  ]);
  const lans = new Map<string, ManagedSandbox>();
  const standalone: ManagedSandbox[] = [];
  function metadata(labels: Record<string, string>) {
    return {
      containerId: '',
      attemptId: labels['tq.attempt'] ?? '',
      createdAt: Number(labels['tq.created'] ?? '0'),
    };
  }
  for (const network of networks) {
    lans.set(network.Id, {
      ...metadata(network.Labels ?? {}),
      networkId: network.Id,
      sidecarIds: {},
    });
  }
  for (const container of containers) {
    const networkId = container.Labels['tq.network'];
    const lan = networkId === undefined ? undefined : lans.get(networkId);
    if (!lan) {
      standalone.push({ ...metadata(container.Labels), containerId: container.Id });
      continue;
    }
    const sidecar = SandboxSidecarSchema.safeParse(container.Labels['tq.sidecar']);
    if (sidecar.success && !lan.sidecarIds?.[sidecar.data]) {
      lan.sidecarIds = { ...lan.sidecarIds, [sidecar.data]: container.Id };
    } else if (!lan.containerId && !sidecar.success) {
      lan.containerId = container.Id;
    } else {
      standalone.push({ ...metadata(container.Labels), containerId: container.Id });
    }
  }
  // Standalone containers (including duplicate-label leftovers) come first.
  return [...standalone, ...lans.values()];
}
