import type { ContainerCreateOptions } from 'dockerode';
import type { SandboxSpec } from './provider.js';

// Container security profiles for plan.md §7.3. Restrictive by default;
// loosened only per the profile table. `lan` networks and sidecars are
// rejected until T10.2 (fail fast rather than silently degrading).

const BASIC_CAPS = ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL'];
const ADMIN_EXTRA_CAPS = ['AUDIT_WRITE', 'SYS_CHROOT', 'NET_BIND_SERVICE'];

export const NO_NEW_PRIVILEGES_OPT = 'no-new-privileges';

export function buildLabels(spec: SandboxSpec): Record<string, string> {
  return {
    'tq.managed': 'true',
    'tq.attempt': spec.attemptId,
    'tq.user': spec.userId,
    'tq.level': spec.levelId,
    'tq.created': String(Math.floor(Date.now() / 1000)),
  };
}

export function buildHostConfig(
  spec: SandboxSpec,
): NonNullable<ContainerCreateOptions['HostConfig']> {
  if (spec.network !== 'none') {
    throw new Error(`network '${spec.network}' is not supported until T10.2 (lan sidecars)`);
  }
  if (spec.sidecars.length > 0) {
    throw new Error('sidecars are not supported until T10.2');
  }

  const memoryBytes = spec.resources.memoryMb * 1024 * 1024;
  const hostConfig: NonNullable<ContainerCreateOptions['HostConfig']> = {
    CapDrop: ['ALL'],
    CapAdd: spec.profile === 'admin' ? [...BASIC_CAPS, ...ADMIN_EXTRA_CAPS] : [...BASIC_CAPS],
    Memory: memoryBytes,
    // Swap allowance equals memory: no swap beyond the limit.
    MemorySwap: memoryBytes,
    NanoCpus: Math.round(spec.resources.cpus * 1_000_000_000),
    PidsLimit: spec.resources.pids,
    Ulimits: [
      { Name: 'nofile', Soft: 1024, Hard: 1024 },
      { Name: 'nproc', Soft: spec.resources.pids, Hard: spec.resources.pids },
      { Name: 'core', Soft: 0, Hard: 0 },
    ],
    NetworkMode: 'none',
    Tmpfs: { '/tmp': 'size=32m,noexec,nosuid' },
    // docker-init as PID 1 supervisor so orphaned exec children are reaped.
    Init: true,
    SecurityOpt: spec.profile === 'basic' ? [NO_NEW_PRIVILEGES_OPT] : [],
  };

  const runtime = process.env['SANDBOX_RUNTIME'];
  if (runtime !== undefined && runtime !== '') {
    hostConfig.Runtime = runtime;
  }
  return hostConfig;
}
