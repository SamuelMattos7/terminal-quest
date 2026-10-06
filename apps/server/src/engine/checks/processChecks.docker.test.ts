import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../checkRunner.js';
import {
  baseCtx,
  closeSandbox,
  openSandbox,
  setupAsRoot,
  type SandboxFixture,
} from '../sandboxFixture.js';

describe('process checks', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t23-process');
    // Copy the binary: `pgrep -x` matches the process name (comm), and
    // `exec -a` only changes argv[0], so a renamed copy is required.
    // (/tmp is noexec in the sandbox; /usr/local/bin is executable.)
    await setupAsRoot(
      fx,
      'cp /bin/sleep /usr/local/bin/t23sleeper && /usr/local/bin/t23sleeper 120 &',
    );
  }, 60_000);

  afterAll(async () => {
    await closeSandbox(fx);
  }, 60_000);

  it('process_running finds a named process, misses unknown ones', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(fx.provider, fx.handle, { type: 'process_running', name: 't23sleeper' }, ctx),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_running', name: 't23nosuchproc' },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_running', cmdline_regex: 't23sleep.*' },
        ctx,
      ),
    ).toBe(true);
  });

  it('process_absent is the mirror image', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_absent', name: 't23nosuchproc' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(fx.provider, fx.handle, { type: 'process_absent', name: 't23sleeper' }, ctx),
    ).toBe(false);
  });

  it('process_state matches the first stat character', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_state', cmdline_regex: 't23sleeper', state: 'S' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_state', cmdline_regex: 't23sleeper', state: 'R' },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'process_state', cmdline_regex: 't23nosuchproc', state: 'S' },
        ctx,
      ),
    ).toBe(false);
  });
});
