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

describe('shell, network, and exec checks', () => {
  let fx: SandboxFixture;

  beforeAll(async () => {
    fx = await openSandbox('t23-shell');
    await setupAsRoot(
      fx,
      'echo -n hunter2 > /opt/tq/secret/t23ans && chmod 600 /opt/tq/secret/t23ans && ' +
        'mkdir -p /opt/tq/checks/t23 && ' +
        `printf '#!/bin/bash\\ntest "$TQ_SEED" = 7\\n' > /opt/tq/checks/t23/verify.sh && ` +
        'chmod 755 /opt/tq/checks/t23/verify.sh && ' +
        'nohup python3 -m http.server 18099 --bind 127.0.0.1 >/tmp/t23-http.log 2>&1 &',
    );
  }, 60_000);

  afterAll(async () => {
    await setupAsRoot(fx, 'pkill -f "http.server 18099" || true').catch(() => undefined);
    await closeSandbox(fx);
  }, 60_000);

  it('shell_cwd tracks the interactive shell directory', async () => {
    const ctx = baseCtx();
    const shell = await fx.provider.openShell(fx.handle, { cols: 80, rows: 24 });
    try {
      shell.write('cd /tmp\n');
      const deadline = Date.now() + 10_000;
      let atTmp = false;
      while (!atTmp && Date.now() < deadline) {
        atTmp = await runCheck(fx.provider, fx.handle, { type: 'shell_cwd', equals: '/tmp' }, ctx);
        if (!atTmp) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      expect(atTmp).toBe(true);
      expect(
        await runCheck(fx.provider, fx.handle, { type: 'shell_cwd', equals: '/home/player' }, ctx),
      ).toBe(false);
    } finally {
      shell.close();
    }
  });

  it('command_used matches logged commands, exit codes, and counts', async () => {
    const ctx = baseCtx({ commands: [{ command: 'pwd', exitCode: 0 }] });
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'command_used', regex: '^pwd$', min_count: 1, exit_code: 0 },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'command_used', regex: '^ls$', min_count: 1, exit_code: 0 },
        ctx,
      ),
    ).toBe(false);
    const failed = baseCtx({ commands: [{ command: 'pwd', exitCode: 1 }] });
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'command_used', regex: '^pwd$', min_count: 1, exit_code: 0 },
        failed,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'command_used', regex: '^pwd$', min_count: 1, exit_code: 'any' },
        failed,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'command_used', regex: '^pwd$', min_count: 2, exit_code: 0 },
        ctx,
      ),
    ).toBe(false);
  });

  it('answer_equals compares the latest submit with trim and case rules', async () => {
    const submitted = baseCtx({ answers: ['  Hunter2  '] });
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'answer_equals', value: 'hunter2' },
        submitted,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'answer_equals', value: 'hunter2', case_sensitive: false },
        submitted,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'answer_equals', from_file: '/opt/tq/secret/t23ans' },
        baseCtx({ answers: ['hunter2'] }),
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'answer_equals', value: 'anything' },
        baseCtx({ answers: [] }),
      ),
    ).toBe(false);
  });

  it('port_listening detects the python listener only on its port', async () => {
    const ctx = baseCtx();
    const check: Check = { type: 'port_listening', port: 18099, proto: 'tcp' };
    const deadline = Date.now() + 15_000;
    let listening = false;
    while (!listening && Date.now() < deadline) {
      listening = await runCheck(fx.provider, fx.handle, check, ctx);
      if (!listening) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    expect(listening).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'port_listening', port: 18098, proto: 'tcp' },
        ctx,
      ),
    ).toBe(false);
  });

  it('exec runs scripts with TQ_SEED and inline snippets', async () => {
    const ctx = baseCtx();
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'exec', script: 'verify.sh', expect_exit: 0 },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'exec', script: 'missing.sh', expect_exit: 0 },
        ctx,
      ),
    ).toBe(false);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'exec', inline: 'echo hello', expect_exit: 0, stdout_matches: 'hell' },
        ctx,
      ),
    ).toBe(true);
    expect(
      await runCheck(
        fx.provider,
        fx.handle,
        { type: 'exec', inline: 'exit 3', expect_exit: 0 },
        ctx,
      ),
    ).toBe(false);
  });
});
