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
