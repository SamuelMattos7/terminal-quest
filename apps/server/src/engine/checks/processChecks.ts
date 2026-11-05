import type { Check } from '@terminal-quest/shared';
import { shQuote } from '../setupCompiler.js';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { rootShell, type CheckContext } from './context.js';

type ProcessRunning = Extract<Check, { type: 'process_running' }>;
type ProcessAbsent = Extract<Check, { type: 'process_absent' }>;
type ProcessState = Extract<Check, { type: 'process_state' }>;

function pgrepNameArgs(check: { name: string; user?: string }): string {
  const parts = ['pgrep', '-A'];
  if (check.user !== undefined) {
    parts.push('-u', shQuote(check.user));
  }
  parts.push('-x', shQuote(check.name));
  return parts.join(' ');
}

async function anyProcess(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: { name?: string; cmdline_regex?: string; user?: string },
  ctx: CheckContext,
): Promise<boolean> {
  if (check.name !== undefined) {
    // Ignore the probe's ancestors, including its Python exec supervisor.
    const res = await rootShell(
      provider,
      handle,
      pgrepNameArgs({ name: check.name, user: check.user }),
      ctx,
    );
    return res.code === 0;
  }
  // Keep the pattern out of the probe's argv and ignore ancestors such as
  // its Python supervisor when matching interpreter names/command lines.
  const userFlag = check.user !== undefined ? `-u ${shQuote(check.user)} ` : '';
  const res = await rootShell(provider, handle, `pgrep -A ${userFlag}-f "$TQ_PGREP"`, ctx, {
    TQ_PGREP: check.cmdline_regex ?? '',
  });
  return res.code === 0;
}

export async function checkProcessRunning(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: ProcessRunning,
  ctx: CheckContext,
): Promise<boolean> {
  return anyProcess(provider, handle, check, ctx);
}

export async function checkProcessAbsent(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: ProcessAbsent,
  ctx: CheckContext,
): Promise<boolean> {
  return !(await anyProcess(provider, handle, check, ctx));
}

export async function checkProcessState(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: ProcessState,
  ctx: CheckContext,
): Promise<boolean> {
  const pids = await rootShell(provider, handle, 'pgrep -A -f "$TQ_PGREP"', ctx, {
    TQ_PGREP: check.cmdline_regex,
  });
  if (pids.code !== 0) {
    return false;
  }
  for (const pid of pids.stdout.split(/\s+/).filter((p) => p !== '')) {
    if (!/^\d+$/.test(pid)) {
      continue;
    }
    const state = await rootShell(provider, handle, `ps -o stat= -p ${pid}`, ctx);
    if (state.code === 0 && state.stdout.trim().startsWith(check.state)) {
      return true;
    }
  }
  return false;
}
