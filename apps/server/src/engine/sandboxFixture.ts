import { DockerProvider } from '../sandbox/dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from '../sandbox/provider.js';
import type { CheckContext } from './checks/context.js';

// Shared fixture for engine *.docker.test.ts files: one `basic` sandbox
// per file, destroyed afterwards. Tests isolate state in unique paths.

export interface SandboxFixture {
  provider: DockerProvider;
  handle: SandboxHandle;
}

export async function openSandbox(attemptId: string): Promise<SandboxFixture> {
  const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
  const spec: SandboxSpec = {
    attemptId,
    userId: 't23-user',
    levelId: 'w1-02-where-am-i',
    image: 'tq-base',
    profile: 'basic',
    network: 'none',
    sidecars: [],
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/home/player',
    env: {},
  };
  const handle = await provider.create(spec);
  return { provider, handle };
}

export async function closeSandbox(fixture: SandboxFixture): Promise<void> {
  await fixture.provider.destroy(fixture.handle);
}

export function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return { seed: 7, levelId: 't23', answers: [], commands: [], ...overrides };
}

/** Run root shell setup inside the sandbox; throws on failure. */
export async function setupAsRoot(fixture: SandboxFixture, script: string): Promise<void> {
  const res = await fixture.provider.exec(fixture.handle, ['bash', '-c', script], {
    user: 'root',
    timeoutMs: 30_000,
  });
  if (res.code !== 0) {
    throw new Error(`fixture setup failed: ${script}\n${res.stderr}`);
  }
}
