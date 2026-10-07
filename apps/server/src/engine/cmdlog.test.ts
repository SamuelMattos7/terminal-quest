import { describe, expect, it } from 'vitest';
import { countCommands, parseCmdlogLine } from './cmdlog.js';

describe('parseCmdlogLine', () => {
  it('parses a well-formed line', () => {
    expect(parseCmdlogLine('1710000000\t0\t/home/player\tls -la')).toEqual({
      epoch: 1710000000,
      exitCode: 0,
      cwd: '/home/player',
      command: 'ls -la',
    });
  });

  it('keeps tabs inside the command', () => {
    expect(parseCmdlogLine('1\t2\t/d\techo\ta\tb')?.command).toBe('echo\ta\tb');
  });

  it('skips junk lines without throwing', () => {
    for (const junk of ['', 'hello', 'a\tb', 'x\ty\tz\tcmd', '1\t0\t\tls', '1\t0\t/d\t']) {
      expect(parseCmdlogLine(junk), JSON.stringify(junk)).toBeUndefined();
    }
  });
});

describe('countCommands', () => {
  it('excludes clear, history, and tux invocations', () => {
    expect(countCommands(['ls', 'clear', 'history', 'tux submit x', 'tux', 'pwd', ''])).toBe(2);
  });

  it('counts repeated commands every time (bash already deduped consecutively)', () => {
    expect(countCommands(['ls', 'pwd', 'ls'])).toBe(3);
  });
});
