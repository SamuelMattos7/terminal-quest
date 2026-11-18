import Docker from 'dockerode';
import { expect, it, vi } from 'vitest';
import { connectOptions, DockerProvider } from './dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from './provider.js';

const spec: SandboxSpec = {
  attemptId: 't9-2-pids',
  userId: 't9-2-user',
  levelId: 'w1-01-first-words',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 16 },
  startCwd: '/home/player',
  env: {},
};

// A bounded fork probe executes only inside the disposable sandbox. Keep it
// full long enough to test a neighbor, then terminate and reap every child.
const exhaust = `
import errno, subprocess, time
children = []
try:
    for i in range(64):
        try:
            children.append(subprocess.Popen(['/bin/sleep', '30']))
        except OSError as error:
            if error.errno != errno.EAGAIN:
                raise
            current = open('/sys/fs/cgroup/pids.current').read().strip()
            maximum = open('/sys/fs/cgroup/pids.max').read().strip()
            if current != '16' or maximum != '16':
                raise RuntimeError('fork blocked below the per-container budget: ' + current + '/' + maximum)
            print('cgroup-full=' + current, flush=True)
            time.sleep(10)
            break
    else:
        raise RuntimeError('PID cgroup did not contain the bounded fork probe')
finally:
    for child in children:
        child.terminate()
    for child in children:
        child.wait()
`;

it.each(['root', 'player'])(
  'contains %s PID exhaustion to one sandbox and keeps its neighbor usable (T9.2)',
  async (user) => {
    const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
    const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));
    const handles: SandboxHandle[] = [];
    try {
      handles.push(await provider.create({ ...spec, attemptId: `t9-2-full-${user}` }));
      handles.push(await provider.create({ ...spec, attemptId: `t9-2-neighbor-${user}` }));
      const [full, neighbor] = handles;
      const outcomes = await Promise.allSettled([
        provider.exec(full, ['python3', '-c', exhaust], { user, timeoutMs: 20_000 }),
        (async () => {
          await vi.waitFor(
            async () => {
              const stats = await docker.getContainer(full.id).stats({ stream: false });
              expect(stats.pids_stats?.current).toBe(16);
            },
            { timeout: 7000, interval: 100 },
          );
          for (const neighborUser of ['root', 'player']) {
            expect(await provider.exec(neighbor, ['true'], { user: neighborUser })).toMatchObject({
              code: 0,
              timedOut: false,
            });
          }
        })(),
      ]);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason;
      }
      const filled = outcomes[0];
      if (filled.status !== 'fulfilled') throw new Error('missing fork probe result');
      expect(filled.value).toMatchObject({ code: 0, timedOut: false, stdout: 'cgroup-full=16\n' });
      // Both cleanup and a fresh exec must still work after PID exhaustion.
      expect((await provider.exec(full, ['true'], { user })).code).toBe(0);
    } finally {
      await Promise.all(handles.map((handle) => provider.destroy(handle)));
    }
  },
);
