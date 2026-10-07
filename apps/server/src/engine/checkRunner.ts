import type { Check } from '@terminal-quest/shared';
import type { SandboxHandle, SandboxProvider } from '../sandbox/provider.js';
import type { CheckContext } from './checks/context.js';
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

// Evaluates one check against a live sandbox (plan.md §8.2). Returns false
// for timeouts and unmet conditions alike; richer telemetry (check_timeout
// events) attaches in T2.4/T6.3.

export async function runCheck(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: Check,
  ctx: CheckContext,
): Promise<boolean> {
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
      return checkLoginShellEval(provider, handle, check, ctx);
    case 'all':
      return runAll(provider, handle, check.checks, ctx);
    case 'any': {
      for (const sub of check.checks) {
        if (await runCheck(provider, handle, sub, ctx)) {
          return true;
        }
      }
      return false;
    }
    case 'not': {
      for (const sub of check.checks) {
        if (await runCheck(provider, handle, sub, ctx)) {
          return false;
        }
      }
      return true;
    }
    default: {
      const exhaustive: never = check;
      throw new Error(`unsupported check type: ${(exhaustive as Check).type}`);
    }
  }
}

async function runAll(
  provider: SandboxProvider,
  handle: SandboxHandle,
  checks: Check[],
  ctx: CheckContext,
): Promise<boolean> {
  for (const sub of checks) {
    if (!(await runCheck(provider, handle, sub, ctx))) {
      return false;
    }
  }
  return true;
}
