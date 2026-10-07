import type { Check } from '@terminal-quest/shared';
import { shQuote } from '../setupCompiler.js';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { rootShell, type CheckContext } from './context.js';

type CrontabEntry = Extract<Check, { type: 'crontab_entry' }>;
type CronDryRun = Extract<Check, { type: 'cron_dry_run' }>;

interface CronEntry {
  schedule: string;
  command: string;
}

/** Split a crontab listing into entries, skipping blanks/comments/env lines. */
export function parseCrontab(text: string): CronEntry[] {
  const entries: CronEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts[0]?.startsWith('@') === true) {
      const command = parts.slice(1).join(' ');
      if (command !== '' && parts[0] !== undefined) {
        entries.push({ schedule: parts[0], command });
      }
      continue;
    }
    if (parts.length < 6) {
      continue;
    }
    entries.push({ schedule: parts.slice(0, 5).join(' '), command: parts.slice(5).join(' ') });
  }
  return entries;
}

async function readCrontab(
  provider: SandboxProvider,
  handle: SandboxHandle,
  user: string,
  ctx: CheckContext,
): Promise<CronEntry[] | undefined> {
  const res = await rootShell(provider, handle, `crontab -l -u ${shQuote(user)}`, ctx);
  if (res.code !== 0) {
    return undefined;
  }
  return parseCrontab(res.stdout);
}

async function schedulesMatch(
  provider: SandboxProvider,
  handle: SandboxHandle,
  expected: string,
  actual: string,
): Promise<boolean> {
  const res = await provider.exec(handle, ['/opt/tq/bin/cronmatch.py', expected, actual], {
    user: 'root',
    timeoutMs: 5000,
  });
  return !res.timedOut && res.code === 0;
}

export async function checkCrontabEntry(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: CrontabEntry,
  ctx: CheckContext,
): Promise<boolean> {
  const entries = await readCrontab(provider, handle, check.user, ctx);
  if (entries === undefined) {
    return false;
  }
  const commandPattern = new RegExp(check.command_regex);
  for (const entry of entries) {
    if (!(await schedulesMatch(provider, handle, check.schedule, entry.schedule))) {
      continue;
    }
    if (commandPattern.test(entry.command)) {
      return true;
    }
  }
  return false;
}

export async function findDryRunCommand(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: CronDryRun,
  ctx: CheckContext,
): Promise<{ command: string; user: string } | undefined> {
  const entries = await readCrontab(provider, handle, check.user, ctx);
  if (entries === undefined || entries.length === 0) {
    return undefined;
  }
  if (check.entry_index !== undefined) {
    const entry = entries[check.entry_index];
    return entry === undefined ? undefined : { command: entry.command, user: check.user };
  }
  if (check.command_regex !== undefined) {
    const pattern = new RegExp(check.command_regex);
    const entry = entries.find((e) => pattern.test(e.command));
    return entry === undefined ? undefined : { command: entry.command, user: check.user };
  }
  const first = entries[0];
  return first === undefined ? undefined : { command: first.command, user: check.user };
}

async function homeDir(
  provider: SandboxProvider,
  handle: SandboxHandle,
  user: string,
  ctx: CheckContext,
): Promise<string> {
  const res = await rootShell(
    provider,
    handle,
    `getent passwd ${shQuote(user)} | cut -d: -f6`,
    ctx,
  );
  const home = res.stdout.replace(/\n$/, '');
  return home !== '' ? home : `/home/${user}`;
}

export interface OutputExpect {
  exit_code?: number;
  stdout_equals?: string;
  stdout_contains?: string;
  stdout_matches?: string;
  stderr_equals?: string;
  stderr_contains?: string;
  stderr_matches?: string;
}

/** Strip one trailing newline (matches $( ) semantics for level authors). */
export function chomp(output: string): string {
  return output.endsWith('\n') ? output.slice(0, -1) : output;
}

export function evaluateOutputExpect(
  result: { code: number; stdout: string; stderr: string },
  expect_: OutputExpect,
): boolean {
  if (expect_.exit_code !== undefined && result.code !== expect_.exit_code) {
    return false;
  }
  const pairs: [string, string | undefined, 'equals' | 'contains' | 'matches'][] = [
    [result.stdout, expect_.stdout_equals, 'equals'],
    [result.stdout, expect_.stdout_contains, 'contains'],
    [result.stdout, expect_.stdout_matches, 'matches'],
    [result.stderr, expect_.stderr_equals, 'equals'],
    [result.stderr, expect_.stderr_contains, 'contains'],
    [result.stderr, expect_.stderr_matches, 'matches'],
  ];
  for (const [output, expected, kind] of pairs) {
    if (expected === undefined) {
      continue;
    }
    if (kind === 'equals' && chomp(output) !== chomp(expected)) {
      return false;
    }
    if (kind === 'contains' && !output.includes(expected)) {
      return false;
    }
    if (kind === 'matches' && !new RegExp(expected).test(output)) {
      return false;
    }
  }
  return true;
}

export async function checkCronDryRun(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: CronDryRun,
  ctx: CheckContext,
): Promise<boolean> {
  const target = await findDryRunCommand(provider, handle, check, ctx);
  if (target === undefined) {
    return false;
  }
  const home = await homeDir(provider, handle, target.user, ctx);
  // Cron-like minimal environment (plan.md §8.2): no login profile, no PATH
  // beyond the basics, cwd set to HOME. Relative-path jobs fail here — that
  // is the point of the cron-pitfalls level.
  const res = await provider.exec(
    handle,
    [
      'env',
      '-i',
      `HOME=${home}`,
      `LOGNAME=${target.user}`,
      'SHELL=/bin/sh',
      'PATH=/usr/bin:/bin',
      'sh',
      '-c',
      target.command,
    ],
    { user: target.user, cwd: home, timeoutMs: (check.timeout_s ?? 10) * 1000 },
  );
  if (res.timedOut) {
    return false;
  }
  return evaluateOutputExpect(res, check.expect);
}
