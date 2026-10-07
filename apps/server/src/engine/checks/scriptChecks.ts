import type { Check } from '@terminal-quest/shared';
import { shQuote } from '../setupCompiler.js';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { chomp, evaluateOutputExpect } from './cronChecks.js';
import { rootShell } from './context.js';
import type { CheckContext } from './context.js';

type LoginShellEval = Extract<Check, { type: 'login_shell_eval' }>;
type ScriptTests = Extract<Check, { type: 'script_tests' }>;
type ScriptCase = ScriptTests['cases'][number];

export async function checkLoginShellEval(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: LoginShellEval,
  // Login env comes from the shell itself, not the fixed check env.
  _ctx: CheckContext,
): Promise<boolean> {
  // Login shell on purpose: env, aliases, and PATH customizations from the
  // player's profile files must be visible here (unlike cron_dry_run).
  const res = await provider.exec(handle, ['su', '-', check.user, '-c', check.script], {
    user: 'root',
    timeoutMs: 10_000,
  });
  if (res.timedOut) {
    return false;
  }
  if (check.stdout_equals !== undefined) {
    return chomp(res.stdout) === chomp(check.stdout_equals);
  }
  if (check.stdout_matches !== undefined) {
    return new RegExp(check.stdout_matches).test(res.stdout);
  }
  return false;
}

async function runCase(
  provider: SandboxProvider,
  handle: SandboxHandle,
  scriptPath: string,
  index: number,
  testCase: ScriptCase,
  ctx: CheckContext,
): Promise<boolean> {
  const scratch = `/tmp/tq-case-${index}`;
  const prep = await rootShell(
    provider,
    handle,
    `rm -rf ${shQuote(scratch)} && mkdir -p ${shQuote(scratch)} && chown player:player ${shQuote(scratch)}`,
    ctx,
  );
  if (prep.code !== 0) {
    return false;
  }
  for (const line of testCase.setup) {
    const res = await provider.exec(handle, ['bash', '-c', line], {
      user: 'player',
      cwd: scratch,
      timeoutMs: 10_000,
    });
    if (res.code !== 0) {
      return false;
    }
  }
  // Direct exec (not via bash): honors +x and the shebang, so levels can
  // genuinely test executability.
  const res = await provider.exec(handle, [scriptPath, ...testCase.args], {
    user: 'player',
    cwd: scratch,
    env: testCase.env,
    stdin: testCase.stdin,
    timeoutMs: 10_000,
  });
  if (res.timedOut) {
    return false;
  }
  if (
    !evaluateOutputExpect(res, {
      exit_code: testCase.expect.exit_code,
      stdout_equals: testCase.expect.stdout_equals,
      stdout_contains: testCase.expect.stdout_contains,
      stdout_matches: testCase.expect.stdout_matches,
      stderr_equals: testCase.expect.stderr_equals,
      stderr_contains: testCase.expect.stderr_contains,
      stderr_matches: testCase.expect.stderr_matches,
    })
  ) {
    return false;
  }
  for (const file of testCase.expect.files ?? []) {
    const ls = await provider.exec(handle, ['bash', '-c', `compgen -G ${shQuote(file.path)}`], {
      user: 'player',
      timeoutMs: 10_000,
    });
    const matches = ls.stdout.split('\n').filter((l) => l !== '');
    const present = matches.length > 0;
    if (file.exists !== undefined && present !== file.exists) {
      return false;
    }
    if ((file.contains !== undefined || file.matches !== undefined) && matches[0] !== undefined) {
      const content = await provider.exec(handle, ['cat', '--', matches[0]], {
        user: 'player',
        timeoutMs: 10_000,
      });
      if (content.code !== 0) {
        return false;
      }
      if (file.contains !== undefined && !content.stdout.includes(file.contains)) {
        return false;
      }
      if (file.matches !== undefined && !new RegExp(file.matches).test(content.stdout)) {
        return false;
      }
    } else if (file.contains !== undefined || file.matches !== undefined) {
      return false;
    }
  }
  return true;
}

export async function checkScriptTests(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: ScriptTests,
  ctx: CheckContext,
): Promise<boolean> {
  if (check.shellcheck) {
    const lint = await rootShell(
      provider,
      handle,
      `shellcheck -S warning -- ${shQuote(check.path)}`,
      ctx,
    );
    if (lint.code !== 0) {
      return false;
    }
  }
  let index = 0;
  for (const testCase of check.cases) {
    if (!(await runCase(provider, handle, check.path, index, testCase, ctx))) {
      return false;
    }
    index += 1;
  }
  return true;
}
