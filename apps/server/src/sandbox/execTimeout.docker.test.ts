import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerProvider } from './dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from './provider.js';

const spec: SandboxSpec = {
  attemptId: 'a04-timeouts',
  userId: 'a04-user',
  levelId: 'w1-01-first-words',
  image: 'tq-base',
  profile: 'basic',
  network: 'none',
  sidecars: [],
  resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
  startCwd: '/home/player',
  env: {},
};

describe('exec process termination (A04)', () => {
  const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
  let h: SandboxHandle;

  beforeAll(async () => {
    h = await provider.create(spec);
  });
  afterAll(async () => {
    if (h) await provider.destroy(h);
  });

  async function expectGone(pids: string[]) {
    expect(pids.length).toBeGreaterThan(0);
    expect(pids.every((pid) => /^\d+$/.test(pid))).toBe(true);
    const probe = await provider.exec(h, [
      'bash',
      '-c',
      'for pid; do if test -e /proc/"$pid"; then cat /proc/"$pid"/stat; fi; done',
      'probe',
      ...pids,
    ]);
    // Zombies count as survivors too: timeout must reap, not just signal.
    expect(probe).toMatchObject({ code: 0, stdout: '', timedOut: false });
  }

  it.each(['root', 'player'])(
    'terminates and reaps a direct %s command on repeated timeouts',
    async (user) => {
      for (let i = 0; i < 3; i++) {
        const result = await provider.exec(h, ['bash', '-c', 'echo $$; exec sleep 60'], {
          user,
          timeoutMs: 250,
        });
        expect(result).toMatchObject({ code: -1, timedOut: true });
        await expectGone(result.stdout.trim().split('\n'));
      }
      expect((await provider.exec(h, ['true'])).code).toBe(0);
    },
  );

  it.each(['root', 'player'])(
    'terminates nested, detached and TERM-ignoring %s descendants',
    async (user) => {
      const script = `
import os, signal, time
print(os.getpid(), flush=True)
if os.fork() == 0:
    os.setsid()
    if os.fork() != 0:
        os._exit(0)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print(os.getpid(), flush=True)
    if os.fork() == 0:
        print(os.getpid(), flush=True)
    time.sleep(60)
else:
    os.wait()
    time.sleep(60)
`;
      const result = await provider.exec(h, ['/usr/bin/python3', '-c', script], {
        user,
        timeoutMs: 1000,
      });
      expect(result).toMatchObject({ code: -1, timedOut: true });
      const pids = result.stdout.trim().split('\n');
      expect(pids).toHaveLength(3);
      await expectGone(pids);
    },
  );

  it('preserves argv, cwd, environment, stdin and ordinary exit codes', async () => {
    const result = await provider.exec(
      h,
      [
        'bash',
        '-c',
        'read -r line; printf "%s|%s|%s|%s" "$1" "$PWD" "$CUSTOM" "$line"; echo err >&2; exit 124',
        'command',
        'a; b $(false)',
      ],
      { user: 'player', cwd: '/home/player', env: { CUSTOM: 'value' }, stdin: 'input\n' },
    );
    expect(result).toEqual({
      code: 124,
      stdout: 'a; b $(false)|/home/player|value|input',
      stderr: 'err\n',
      timedOut: false,
    });
  });

  it('prevents descendants from mutating state after timeout returns', async () => {
    const result = await provider.exec(
      h,
      ['bash', '-c', 'echo $$; (sleep 1; touch /tmp/a04-late-write) & wait'],
      { timeoutMs: 200 },
    );
    expect(result).toMatchObject({ code: -1, timedOut: true });
    await expectGone(result.stdout.trim().split('\n'));
    const probe = await provider.exec(h, ['bash', '-c', 'sleep 1; test ! -e /tmp/a04-late-write']);
    expect(probe).toMatchObject({ code: 0, timedOut: false });
    expect((await provider.exec(h, ['true'])).code).toBe(0);
  });

  it('keeps the supervisor protected from player signals', async () => {
    const result = await provider.exec(
      h,
      [
        '/usr/bin/python3',
        '-c',
        `
import os, signal, time
print(os.getpid(), flush=True)
try:
    os.kill(os.getppid(), signal.SIGKILL)
except PermissionError:
    print('protected', file=__import__('sys').stderr, flush=True)
time.sleep(60)
`,
      ],
      { user: 'player', timeoutMs: 500 },
    );
    expect(result).toMatchObject({ code: -1, timedOut: true, stderr: 'protected\n' });
    await expectGone(result.stdout.trim().split('\n'));
  });

  it('leaves an intentional background service alive after successful exec and an unrelated timeout', async () => {
    const launched = await provider.exec(h, ['bash', '-c', 'sleep 60 & echo $!']);
    expect(launched).toMatchObject({ code: 0, timedOut: false });
    const pid = launched.stdout.trim();
    try {
      const timed = await provider.exec(h, ['sleep', '60'], { timeoutMs: 100 });
      expect(timed).toMatchObject({ code: -1, timedOut: true });
      expect((await provider.exec(h, ['kill', '-0', pid])).code).toBe(0);
    } finally {
      await provider.exec(h, ['kill', '-9', pid]);
    }
  });

  it('terminates a root command that launches player-owned descendants', async () => {
    const result = await provider.exec(
      h,
      [
        'bash',
        '-c',
        'echo $$; /usr/sbin/runuser -u player -- bash -c "echo \\$\\$; exec sleep 60" & echo $!; wait',
      ],
      { timeoutMs: 500 },
    );
    expect(result).toMatchObject({ code: -1, timedOut: true });
    const pids = result.stdout.trim().split('\n');
    expect(pids).toHaveLength(3);
    await expectGone(pids);
  });
});
