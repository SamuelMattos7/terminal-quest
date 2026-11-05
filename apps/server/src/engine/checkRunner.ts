import type { Check } from '@terminal-quest/shared';
import type { SandboxHandle } from '../sandbox/provider.js';
import type { CheckContext, CheckProbe } from './checks/context.js';
import {
  checkFileAbsent,
  checkFileContent,
  checkFileExists,
  checkFileMode,
  checkFileOwner,
  checkSymlinkTarget,
  checkDirListing,
} from './checks/fileChecks.js';
import {
  checkProcessAbsent,
  checkProcessRunning,
  checkProcessState,
} from './checks/processChecks.js';
import { checkAnswerEquals, checkCommandUsed, checkShellCwd } from './checks/shellChecks.js';
import { checkExec, checkPortListening } from './checks/netExecChecks.js';
import { checkCrontabEntry, checkCronDryRun } from './checks/cronChecks.js';
import { checkLoginShellEval, checkScriptTests } from './checks/scriptChecks.js';

type LeafCheck = Exclude<Check, { type: 'all' | 'any' | 'not' }>;

class CheckTimeoutError extends Error {
  constructor(readonly checkType: LeafCheck['type']) {
    super(`check probe timed out: ${checkType}`);
  }
}

export async function runCheck(
  provider: CheckProbe,
  handle: SandboxHandle,
  check: Check,
  ctx: CheckContext,
): Promise<boolean> {
  try {
    return await evaluateCheck(provider, handle, check, ctx);
  } catch (err) {
    if (!(err instanceof CheckTimeoutError)) throw err;
    ctx.onTimeout?.(err.checkType);
    return false;
  }
}

async function evaluateCheck(
  provider: CheckProbe,
  handle: SandboxHandle,
  check: Check,
  ctx: CheckContext,
): Promise<boolean> {
  if (check.type === 'all' || check.type === 'any' || check.type === 'not') {
    const all = check.type === 'all';
    for (const sub of check.checks) {
      if ((await evaluateCheck(provider, handle, sub, ctx)) !== all) return check.type === 'any';
    }
    return check.type !== 'any';
  }
  // A timeout makes the condition unknown. Abort the objective so a negated
  // condition or absence probe cannot treat a timeout as proof of success.
  return runLeaf(
    {
      async exec(...args) {
        const result = await provider.exec(...args);
        if (result.timedOut) throw new CheckTimeoutError(check.type);
        return result;
      },
    },
    handle,
    check,
    ctx,
  );
}

function runLeaf(
  provider: CheckProbe,
  handle: SandboxHandle,
  check: LeafCheck,
  ctx: CheckContext,
): boolean | Promise<boolean> {
  switch (check.type) {
    case 'file_exists':
      return checkFileExists(provider, handle, check, ctx);
    case 'file_absent':
      return checkFileAbsent(provider, handle, check, ctx);
    case 'file_content':
      return checkFileContent(provider, handle, check, ctx);
    case 'file_mode':
      return checkFileMode(provider, handle, check, ctx);
    case 'file_owner':
      return checkFileOwner(provider, handle, check, ctx);
    case 'symlink_target':
      return checkSymlinkTarget(provider, handle, check, ctx);
    case 'dir_listing':
      return checkDirListing(provider, handle, check, ctx);
    case 'shell_cwd':
      return checkShellCwd(provider, handle, check, ctx);
    case 'command_used':
      return checkCommandUsed(check, ctx);
    case 'answer_equals':
      return checkAnswerEquals(provider, handle, check, ctx);
    case 'process_running':
      return checkProcessRunning(provider, handle, check, ctx);
    case 'process_absent':
      return checkProcessAbsent(provider, handle, check, ctx);
    case 'process_state':
      return checkProcessState(provider, handle, check, ctx);
    case 'port_listening':
      return checkPortListening(provider, handle, check, ctx);
    case 'exec':
      return checkExec(provider, handle, check, ctx);
    case 'script_tests':
      return checkScriptTests(provider, handle, check, ctx);
    case 'crontab_entry':
      return checkCrontabEntry(provider, handle, check, ctx);
    case 'cron_dry_run':
      return checkCronDryRun(provider, handle, check, ctx);
    case 'login_shell_eval':
      return checkLoginShellEval(provider, handle, check);
    default: {
      const exhaustive: never = check;
      throw new Error(`unsupported check type: ${(exhaustive as Check).type}`);
    }
  }
}
