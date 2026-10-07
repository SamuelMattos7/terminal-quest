import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Check } from '@terminal-quest/shared';
import { runCheck } from '../checkRunner.js';
import {
  baseCtx,
  closeSandbox,
  openSandbox,
  setupAsRoot,
  type SandboxFixture,
} from '../sandboxFixture.js';

describe('script and login-shell checks', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t25-script');
    // Quoted heredocs so the outer shell writes every $ literally.
    await setupAsRoot(
      fx,
      "cat > /home/player/add.sh <<'FIXTURE_EOF'\n" +
        '#!/bin/bash\n' +
        'if [ "$#" -ne 2 ]; then echo "Usage: add a b" >&2; exit 64; fi\n' +
        'echo $(($1 + $2))\n' +
        'FIXTURE_EOF\n' +
        'chmod 755 /home/player/add.sh && chown player:player /home/player/add.sh && ' +
        "cat > /home/player/sloppy.sh <<'FIXTURE_EOF'\n" +
        '#!/bin/bash\n' +
        'echo $(ls /tmp)\n' +
        'FIXTURE_EOF\n' +
        'chmod 755 /home/player/sloppy.sh && chown player:player /home/player/sloppy.sh && ' +
        "printf 'export TQ_PROBE=yes\\n' >> /home/player/.profile && chown player:player /home/player/.profile",
    );
  }, 60_000);

  afterAll(async () => {
    await closeSandbox(fx);
  }, 60_000);

  it('passes usage and happy-path cases, fails wrong output', async () => {
    const ctx = baseCtx();
    const check: Check = {
      type: 'script_tests',
      path: '/home/player/add.sh',
      shellcheck: false,
      cases: [
        {
          name: 'usage on no args',
          args: [],
          setup: [],
          hidden: false,
          expect: { exit_code: 64, stderr_matches: 'Usage:' },
        },
        {
          name: 'adds two numbers',
          args: ['2', '3'],
          setup: [],
          hidden: false,
          expect: { exit_code: 0, stdout_equals: '5' },
        },
      ],
    };
    expect(await runCheck(fx.provider, fx.handle, check, ctx)).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'script_tests',
          path: '/home/player/add.sh',
          shellcheck: false,
          cases: [
            {
              name: 'wrong sum',
              args: ['2', '3'],
              setup: [],
              hidden: false,
              expect: { exit_code: 0, stdout_equals: '6' },
            },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('fails shellcheck-unclean scripts when enabled, and checks file outputs', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'script_tests',
          path: '/home/player/sloppy.sh',
          shellcheck: true,
          cases: [
            { name: 'runs', args: ['x'], setup: [], hidden: false, expect: { exit_code: 0 } },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });

  it('sees login-shell environment via su -', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'login_shell_eval',
          user: 'player',
          script: 'echo $HOME',
          stdout_equals: '/home/player',
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'login_shell_eval',
          user: 'player',
          script: 'echo $TQ_PROBE',
          stdout_equals: 'yes',
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'login_shell_eval', user: 'player', script: 'echo $HOME', stdout_equals: '/root' },
        ctx,
      ),
    ).toBe(false);
  });
});
