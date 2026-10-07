import type { LoggedCommand } from './checks/context.js';

// cmdlog parsing for plan.md §7.4: each finished command lands in
// `/run/tq/cmdlog` as `epoch<TAB>exit<TAB>cwd<TAB>command`. Junk lines
// (partial writes, player tampering per D-007) are skipped, never fatal.

export interface CmdlogEntry extends LoggedCommand {
  epoch: number;
  cwd: string;
}

export function parseCmdlogLine(line: string): CmdlogEntry | undefined {
  const first = line.indexOf('\t');
  if (first < 0) {
    return undefined;
  }
  const second = line.indexOf('\t', first + 1);
  if (second < 0) {
    return undefined;
  }
  const third = line.indexOf('\t', second + 1);
  if (third < 0) {
    return undefined;
  }
  const epoch = Number(line.slice(0, first));
  const exitCode = Number(line.slice(first + 1, second));
  const cwd = line.slice(second + 1, third);
  const command = line.slice(third + 1);
  if (!Number.isInteger(epoch) || !Number.isInteger(exitCode) || cwd === '' || command === '') {
    return undefined;
  }
  return { epoch, exitCode, cwd, command };
}

/**
 * Commands counted for rank (§10.1): raw cmdlog command lines minus
 * `clear`, `history`, and `tux *`. Consecutive-duplicate suppression
 * already happened in bash via HISTCONTROL=ignoredups.
 */
export function countCommands(commands: string[]): number {
  return commands.filter((c) => {
    const cmd = c.trim();
    return cmd !== '' && cmd !== 'clear' && cmd !== 'history' && !/^tux(\s|$)/.test(cmd);
  }).length;
}
