import { describe, expect, it } from 'vitest';
import { CheckSchema } from './checks.js';

describe('CheckSchema', () => {
  it('parses file_exists and defaults kind to any', () => {
    expect(CheckSchema.parse({ type: 'file_exists', path: '/home/player/a.txt' })).toEqual({
      type: 'file_exists',
      path: '/home/player/a.txt',
      kind: 'any',
    });
  });

  it('rejects a relative path', () => {
    expect(() => CheckSchema.parse({ type: 'file_exists', path: 'a.txt' })).toThrow();
  });

  it('parses file_content with one comparator and defaults trim', () => {
    expect(CheckSchema.parse({ type: 'file_content', path: '/x', equals: 'hi\n' })).toMatchObject({
      type: 'file_content',
      trim: true,
    });
  });

  it('rejects file_content with two comparators', () => {
    expect(() =>
      CheckSchema.parse({ type: 'file_content', path: '/x', equals: 'a', contains: 'b' }),
    ).toThrow();
  });

  it('rejects file_content with no comparator', () => {
    expect(() => CheckSchema.parse({ type: 'file_content', path: '/x' })).toThrow();
  });

  it('rejects an unknown check type', () => {
    expect(() => CheckSchema.parse({ type: 'file_created', path: '/x' })).toThrow();
  });

  it('rejects unknown keys (strict mode catches typos)', () => {
    expect(() => CheckSchema.parse({ type: 'file_exists', path: '/x', kindd: 'file' })).toThrow();
  });

  it('parses answer_equals from_file', () => {
    expect(
      CheckSchema.parse({ type: 'answer_equals', from_file: '/opt/tq/secret/w' }),
    ).toMatchObject({ type: 'answer_equals' });
  });

  it('rejects answer_equals with neither value nor from_file', () => {
    expect(() => CheckSchema.parse({ type: 'answer_equals' })).toThrow();
  });

  it('parses command_used with defaults and exit_code any', () => {
    expect(CheckSchema.parse({ type: 'command_used', regex: '^pwd$' })).toEqual({
      type: 'command_used',
      regex: '^pwd$',
      min_count: 1,
      exit_code: 0,
    });
    expect(CheckSchema.parse({ type: 'command_used', regex: 'x', exit_code: 'any' })).toMatchObject(
      { exit_code: 'any' },
    );
  });

  it('parses nested combinators', () => {
    expect(
      CheckSchema.parse({
        type: 'all',
        checks: [
          { type: 'file_absent', path: '/tmp/junk' },
          {
            type: 'any',
            checks: [
              { type: 'file_exists', path: '/a' },
              { type: 'not', checks: [{ type: 'file_exists', path: '/b' }] },
            ],
          },
        ],
      }),
    ).toMatchObject({ type: 'all' });
  });

  it('rejects combinators with empty checks', () => {
    expect(() => CheckSchema.parse({ type: 'all', checks: [] })).toThrow();
  });

  it('parses exec with script and rejects script+inline ambiguity', () => {
    expect(CheckSchema.parse({ type: 'exec', script: 'checks/verify.sh' })).toMatchObject({
      type: 'exec',
      expect_exit: 0,
    });
    expect(() =>
      CheckSchema.parse({ type: 'exec', script: 'a.sh', inline: 'test -f /a' }),
    ).toThrow();
    expect(() => CheckSchema.parse({ type: 'exec' })).toThrow();
  });

  it('parses a minimal script_tests case and rejects empty cases', () => {
    expect(
      CheckSchema.parse({
        type: 'script_tests',
        path: '/home/player/backup.sh',
        cases: [{ name: 'usage', args: [], expect: { exit_code: 64 } }],
      }),
    ).toMatchObject({ type: 'script_tests', shellcheck: false });
    expect(() =>
      CheckSchema.parse({ type: 'script_tests', path: '/home/player/b.sh', cases: [] }),
    ).toThrow();
  });

  it('enforces port bounds and process_state values', () => {
    expect(CheckSchema.parse({ type: 'port_listening', port: 8080 })).toMatchObject({
      proto: 'tcp',
    });
    expect(() => CheckSchema.parse({ type: 'port_listening', port: 0 })).toThrow();
    expect(() =>
      CheckSchema.parse({ type: 'process_state', cmdline_regex: 'x', state: 'Q' }),
    ).toThrow();
  });

  it('rejects file_mode with a bad mode and file_owner with neither user nor group', () => {
    expect(() => CheckSchema.parse({ type: 'file_mode', path: '/x', mode: '999' })).toThrow();
    expect(() => CheckSchema.parse({ type: 'file_owner', path: '/x' })).toThrow();
  });

  it('rejects login_shell_eval without an assertion', () => {
    expect(() =>
      CheckSchema.parse({ type: 'login_shell_eval', user: 'player', script: 'echo hi' }),
    ).toThrow();
  });
});
