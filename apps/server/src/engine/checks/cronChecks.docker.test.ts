import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../checkRunner.js';
import {
  baseCtx,
  closeSandbox,
  openSandbox,
  setupAsRoot,
  type SandboxFixture,
} from '../sandboxFixture.js';

describe('cron checks', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t25-cron');
    await setupAsRoot(
      fx,
      'python3 -c "import croniter" && ' +
        "printf '*/5 * * * * /usr/local/bin/t25-abs.sh\\n0 0 * * * /usr/bin/t25-other\\n' | crontab -u player - && " +
        'printf \'#!/bin/sh\\necho "cron was here"\\n\' > /usr/local/bin/t25-abs.sh && chmod 755 /usr/local/bin/t25-abs.sh && ' +
        'mkdir -p /home/player/scripts && ' +
        "printf '#!/bin/sh\\necho relative\\n' > /home/player/scripts/t25-rel.sh && chmod 755 /home/player/scripts/t25-rel.sh && " +
        'chown -R player:player /home/player/scripts',
    );
  }, 60_000);

  afterAll(async () => {
    await closeSandbox(fx);
  }, 60_000);

  it('previews exactly five upcoming UTC runs as the player', async () => {
    const preview = await fx.provider.exec(
      fx.handle,
      ['sh', '-ec', 'date +%s; /opt/tq/bin/tux cron "$1"; date +%s', 'sh', '*/5 * * * *'],
      { user: 'player', timeoutMs: 5000 },
    );
    expect(preview.code).toBe(0);
    expect(preview.stderr).toBe('');
    const [before, heading, ...lines] = preview.stdout.trim().split('\n');
    const after = Number(lines.pop());
    expect(heading).toBe('Next 5 simulated runs (UTC)');
    expect(lines).toHaveLength(5);
    const runTimes = lines.map((line) => {
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      return Date.parse(line.replace(' ', 'T').replace(' UTC', ':00Z')) / 1_000;
    });
    const interval = 5 * 60;
    const nextRun = (now: number) => (Math.floor(now / interval) + 1) * interval;
    const expectedRuns = (now: number) => lines.map((_, index) => nextRun(now) + index * interval);
    expect([expectedRuns(Number(before)), expectedRuns(after)]).toContainEqual(runTimes);
  });

  it('includes cron preview in Tux help and supports calendar aliases', async () => {
    const help = await fx.provider.exec(fx.handle, ['/opt/tq/bin/tux', 'help'], { user: 'player' });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("cron '<schedule>'");
    const preview = await fx.provider.exec(fx.handle, ['/opt/tq/bin/tux', 'cron', '@daily'], {
      user: 'player',
    });
    expect(preview.code).toBe(0);
    const dates = preview.stdout.trim().split('\n').slice(1);
    expect(dates).toHaveLength(5);
    for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2} 00:00 UTC$/);
  });

  it.each([
    { args: [], error: 'Usage: tux cron' },
    { args: ['* * * * * *'], error: 'expected a five-field schedule' },
    { args: ['60 * * * *'], error: 'bad schedule' },
    { args: ['@reboot'], error: 'has no calendar fire times' },
  ])('rejects a non-calendar cron preview for $args', async ({ args, error }) => {
    const result = await fx.provider.exec(fx.handle, ['/opt/tq/bin/tux', 'cron', ...args], {
      user: 'player',
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(error);
  });

  it('matches schedules semantically, including */5 ≡ minute list', async () => {
    const ctx = baseCtx();
    const match = await runCheck(
      fx.provider,
      fx.handle,
      {
        type: 'crontab_entry',
        user: 'player',
        schedule: '0,5,10,15,20,25,30,35,40,45,50,55 * * * *',
        command_regex: 't25-abs',
      },
      ctx,
    );
    expect(match).toBe(true);
  });

  it('matches @daily against 0 0 * * * and rejects different schedules', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'crontab_entry', user: 'player', schedule: '@daily', command_regex: 't25-other' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'crontab_entry', user: 'player', schedule: '0 * * * *', command_regex: 't25-abs' },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'crontab_entry',
          user: 'player',
          schedule: '*/5 * * * *',
          command_regex: 't25-missing',
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('dry-runs an absolute-path job successfully', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'cron_dry_run',
          user: 'player',
          command_regex: 't25-abs',
          expect: { exit_code: 0, stdout_contains: 'cron was here' },
        },
        ctx,
      ),
    ).toBe(true);
  });

  it('dry-run fails for relative-path jobs in the cron-like env', async () => {
    const ctx = baseCtx();
    // Last test: replace the crontab — earlier tests already ran.
    await setupAsRoot(fx, `printf '* * * * * ./t25-rel.sh\\n' | crontab -u player -`);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'cron_dry_run',
          user: 'player',
          command_regex: 't25-rel',
          expect: { exit_code: 0, stdout_contains: 'relative' },
        },
        ctx,
      ),
    ).toBe(false);
  });
});
