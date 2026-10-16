import type { Check } from '@terminal-quest/shared';
import { shQuote } from '../setupCompiler.js';
import type { SandboxHandle, SandboxProvider } from '../../sandbox/provider.js';
import { rootShell, type CheckContext } from './context.js';

type ShellCwd = Extract<Check, { type: 'shell_cwd' }>;
type CommandUsed = Extract<Check, { type: 'command_used' }>;
type AnswerEquals = Extract<Check, { type: 'answer_equals' }>;

export async function checkShellCwd(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: ShellCwd,
  ctx: CheckContext,
): Promise<boolean> {
  // The oldest `bash` of `player` is the interactive shell (AGENTS.md §9).
  // The readlink runs *as player* via runuser: root in the `basic` profile
  // lacks CAP_SYS_PTRACE, so cross-UID /proc/*/cwd reads are denied (D-013).
  // Same-UID reads need no extra capabilities; the exec is still
  // root-initiated and the probe is read-only.
  const res = await rootShell(
    provider,
    handle,
    '/usr/sbin/runuser -u player -- readlink /proc/$(pgrep -o -u player -x bash)/cwd',
    ctx,
  );
  return res.code === 0 && res.stdout.replace(/\n$/, '') === check.equals;
}

export function checkCommandUsed(check: CommandUsed, ctx: CheckContext): boolean {
  const pattern = new RegExp(check.regex);
  const matches = ctx.commands.filter(
    (c) => pattern.test(c.command) && (check.exit_code === 'any' || c.exitCode === check.exit_code),
  );
  return matches.length >= check.min_count;
}

export async function checkAnswerEquals(
  provider: SandboxProvider,
  handle: SandboxHandle,
  check: AnswerEquals,
  ctx: CheckContext,
): Promise<boolean> {
  // Any-match (D-019): a level may require several answers submitted over
  // time (w1-09, w2-15). Objectives are sticky, so each correct submit
  // completes its objective the moment it arrives live; the harness, which
  // evaluates once after the whole solution, needs every past submit visible.
  if (ctx.answers.length === 0) {
    return false;
  }
  let expected: string | undefined;
  if (check.value !== undefined) {
    expected = check.value;
  } else if (check.from_file !== undefined) {
    const res = await rootShell(provider, handle, `cat -- ${shQuote(check.from_file)}`, ctx);
    if (res.code !== 0) {
      return false;
    }
    expected = res.stdout;
  } else {
    return false;
  }
  const trim = check.trim ?? true;
  const normalize = (s: string): string => (trim ? s.replace(/\s+$/, '').replace(/^\s+/, '') : s);
  const want = normalize(expected);
  const candidates =
    (check.case_sensitive ?? true)
      ? ctx.answers.map(normalize)
      : ctx.answers.map((a) => normalize(a).toLowerCase());
  const target = (check.case_sensitive ?? true) ? want : want.toLowerCase();
  return candidates.includes(target);
}
