import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadLevels } from '../engine/levelLoader.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';
import { connectOptions, DockerProvider } from './dockerProvider.js';
import type { SandboxHandle } from './provider.js';

const socketPath = process.env['DOCKER_SOCKET'];
const provider = new DockerProvider({ socketPath });
const levels = loadLevels(
  fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url)),
);
const level = levels.byId.get('w4-14-systemd-units')!;
const levelDir = levels.levelDirs.get(level.id)!;

describe('systemd simulation (T10.4)', () => {
  let handle: SandboxHandle | undefined;

  async function player(script: string) {
    if (handle === undefined) throw new Error('sandbox not created');
    return provider.exec(handle, ['sh', '-ec', 'export PATH=/opt/tq/bin:$PATH\n' + script], {
      user: 'player',
      timeoutMs: 5000,
    });
  }

  beforeAll(async () => {
    handle = await provider.create({
      attemptId: 't10-4-systemd',
      userId: 'systemd-test',
      levelId: level.id,
      image: level.sandbox.image,
      profile: 'admin',
      network: 'none',
      sidecars: [],
      resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
      startCwd: '/home/player',
      env: {},
    });
    await runSetup(provider, handle, compileSetup(level, levelDir, 1), 1);
  });

  afterAll(async () => {
    if (handle !== undefined) await provider.destroy(handle);
  });

  it('uses the standard isolated admin container and leaves cron off for the lesson', async () => {
    const docker = new Docker(connectOptions(socketPath));
    const container = await docker.getContainer(handle!.id).inspect();
    expect(container.HostConfig).toMatchObject({
      Init: true,
      Privileged: false,
      CapDrop: ['ALL'],
      NetworkMode: 'none',
    });
    expect(container.HostConfig.CapAdd).not.toContain('SYS_ADMIN');
    expect(container.Mounts).toEqual([]);
    expect((await player('pgrep -x cron')).code).toBe(1);
    expect(await player('systemctl list-timers')).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('NEXT (UTC)'),
    });
  });

  it('loads edits, starts, restarts and stops a foreground service', async () => {
    const result = await player(`
cat >/etc/systemd/system/wait.service <<'UNIT'
[Service]
Type=simple
User=player
ExecStart=/usr/bin/sleep 30
UNIT
systemctl daemon-reload
systemctl start wait.service
first=$(systemctl status wait.service | sed -n 's/^Main PID: //p')
test -n "$first"
sed -i 's/sleep 30/sleep 31/' /etc/systemd/system/wait.service
systemctl status wait.service | grep -Fx 'ExecStart: /usr/bin/sleep 30'
systemctl daemon-reload
systemctl restart wait.service
state=$(systemctl status wait.service)
printf '%s\\n' "$state" | grep -Fx 'ExecStart: /usr/bin/sleep 31'
second=$(printf '%s\\n' "$state" | sed -n 's/^Main PID: //p')
test -n "$second"
test "$first" != "$second"
test ! -d "/proc/$first"
systemctl stop wait.service
test ! -d "/proc/$second"
systemctl status wait.service
`);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Active: inactive (dead)');
  });

  it('retries a failed service as player and logs both output streams', async () => {
    const result = await player(`
cat >/home/player/retry.sh <<'SCRIPT'
if [ -e "$HOME/retry-first" ]; then
  printf 'second run uid=%s\\n' "$(id -u)"
  exit 0
fi
: > "$HOME/retry-first"
printf 'first run failed\\n' >&2
exit 7
SCRIPT
cat >/etc/systemd/system/retry.service <<'UNIT'
[Service]
ExecStart=/bin/sh /home/player/retry.sh
Restart=on-failure
UNIT
systemctl daemon-reload
systemctl start retry.service
`);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    await expect
      .poll(async () => (await player('systemctl status retry.service')).stdout, { timeout: 5000 })
      .toContain('Result: exit 0');
    expect(await player('journalctl -u retry.service')).toMatchObject({
      code: 0,
      stdout: 'first run failed\nsecond run uid=1000\n',
    });
  });

  it('enables a timer separately from starting it, fires at its UTC time, and rearms it', async () => {
    const result = await player(`
cat >/etc/systemd/system/calendar.service <<'UNIT'
[Service]
ExecStart=/usr/local/bin/report.sh
UNIT
clock=$(date -u -d '+8 seconds' +%H:%M:%S)
printf '[Timer]\\nUnit=calendar.service\\nOnCalendar=*-*-* %s\\n' "$clock" >/etc/systemd/system/schedule.timer
systemctl daemon-reload
systemctl enable schedule.timer
state=$(systemctl status schedule.timer)
printf '%s\\n' "$state" | grep -Fx 'Loaded: loaded (enabled)'
printf '%s\\n' "$state" | grep -Fx 'Active: inactive (dead)'
systemctl start schedule.timer
systemctl list-timers | grep -F "T$clock+00:00  schedule.timer  calendar.service"
`);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    await expect
      .poll(async () => (await player('journalctl -u calendar.service')).stdout, {
        timeout: 15_000,
      })
      .toBe('Engine Room report generated by player.\n');
    const next = await player('systemctl list-timers | grep -F schedule.timer');
    expect(next.code).toBe(0);
    expect(Date.parse(next.stdout.split(/\s+/)[0]!) - Date.now()).toBeGreaterThan(23 * 60 * 60_000);

    const stopped = await player(
      'systemctl stop schedule.timer; systemctl disable schedule.timer; systemctl status schedule.timer',
    );
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain('Loaded: loaded (disabled)');
    expect(stopped.stdout).toContain('Active: inactive (dead)');
  });

  it('honors a non-root User and rejects root without replacing the loaded unit', async () => {
    const result = await player(`
sudo -n useradd -m report-worker
cat >/etc/systemd/system/safe.service <<'UNIT'
[Service]
ExecStart=/usr/bin/id -un
User=report-worker
UNIT
systemctl daemon-reload
sed -i 's/User=report-worker/User=root/' /etc/systemd/system/safe.service
if systemctl daemon-reload; then exit 1; fi
systemctl status safe.service
systemctl start safe.service
`);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('User must be an ordinary non-root sandbox account');
    expect(result.stdout).toContain('User: report-worker');
    await expect
      .poll(async () => (await player('journalctl -u safe.service')).stdout)
      .toBe('report-worker\n');
  });
});
