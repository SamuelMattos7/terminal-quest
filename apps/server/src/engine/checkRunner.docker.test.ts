import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Check } from '@terminal-quest/shared';
import { runCheck } from './checkRunner.js';
import { baseCtx, closeSandbox, openSandbox, type SandboxFixture } from './sandboxFixture.js';

describe('checkRunner combinators and environment', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t23-runner');
  }, 60_000);

  afterAll(async () => {
    await closeSandbox(fx);
  }, 60_000);

  it('all needs every sub-check, any needs one', async () => {
    const ctx = baseCtx();
    const yes: Check = { type: 'file_absent', path: '/tmp/t23-nothing-here' };
    const no: Check = { type: 'file_exists', path: '/tmp/t23-nothing-here', kind: 'any' };
    expect(await runCheck(fx.provider, fx.handle, { type: 'all', checks: [yes, yes] }, ctx)).toBe(
      true,
    );
    expect(await runCheck(fx.provider, fx.handle, { type: 'all', checks: [yes, no] }, ctx)).toBe(
      false,
    );
    expect(await runCheck(fx.provider, fx.handle, { type: 'any', checks: [no, yes] }, ctx)).toBe(
      true,
    );
    expect(await runCheck(fx.provider, fx.handle, { type: 'any', checks: [no, no] }, ctx)).toBe(
      false,
    );
  });

  it('not passes only when no sub-check passes', async () => {
    const ctx = baseCtx();
    const yes: Check = { type: 'file_absent', path: '/tmp/t23-nothing-here' };
    const no: Check = { type: 'file_exists', path: '/tmp/t23-nothing-here', kind: 'any' };
    expect(await runCheck(fx.provider, fx.handle, { type: 'not', checks: [no] }, ctx)).toBe(true);
    expect(await runCheck(fx.provider, fx.handle, { type: 'not', checks: [yes] }, ctx)).toBe(false);
    expect(await runCheck(fx.provider, fx.handle, { type: 'not', checks: [no, no] }, ctx)).toBe(
      true,
    );
    expect(await runCheck(fx.provider, fx.handle, { type: 'not', checks: [no, yes] }, ctx)).toBe(
      false,
    );
  });

  it('runs checks with the fixed environment plus TQ_SEED', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        {
          type: 'exec',
          inline: 'echo "PATH=$PATH HOME=$HOME SEED=$TQ_SEED"',
          expect_exit: 0,
          stdout_matches: 'PATH=/usr/bin:/bin:/opt/tq/bin HOME=/root SEED=7',
        },
        ctx,
      ),
    ).toBe(true);
  });

  it('rejects check types reserved for T2.5', async () => {
    const ctx = baseCtx();
    await expect(
      runCheck(
        fx.provider,
        fx.handle,
        { type: 'script_tests', path: '/home/player/x.sh', shellcheck: false, cases: [] },
        ctx,
      ),
    ).rejects.toThrow('T2.5');
  });
});
