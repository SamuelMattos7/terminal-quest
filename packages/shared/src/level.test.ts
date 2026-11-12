import { describe, expect, it } from 'vitest';
import { countWords, LevelSchema } from './level.js';
import { validLevelInput } from './test-fixtures.js';

function withOverrides(overrides: Record<string, unknown>): unknown {
  return { ...(validLevelInput as Record<string, unknown>), ...overrides };
}

describe('LevelSchema', () => {
  it('parses the valid §16.3 example level and applies defaults', () => {
    const level = LevelSchema.parse(validLevelInput);
    expect(level.id).toBe('w1-02-where-am-i');
    expect(level.sandbox.profile).toBe('basic');
    expect(level.sandbox.needs_cron).toBe(true);
    expect(level.objectives[0]?.bonus).toBe(false);
    expect(level.objectives).toHaveLength(3);
  });

  it('rejects a level with missing hints (acceptance: exactly 3 required)', () => {
    expect(() => LevelSchema.parse(withOverrides({ hints: ['only one'] }))).toThrow();
    expect(() => LevelSchema.parse(withOverrides({ hints: ['a', 'b', 'c', 'd'] }))).toThrow();
  });

  it('rejects a level with a wrong check type (acceptance)', () => {
    const bad = structuredClone(validLevelInput) as {
      objectives: { check: unknown }[];
    };
    bad.objectives[0]!.check = { type: 'ran_command', regex: '^pwd$' };
    expect(() => LevelSchema.parse(bad)).toThrow();
  });

  it('rejects a story over 80 words', () => {
    expect(countWords('one two three')).toBe(3);
    const story = Array.from({ length: 81 }, (_, i) => `word${i}`).join(' ');
    expect(() => LevelSchema.parse(withOverrides({ story }))).toThrow();
  });

  it('rejects a title over 40 chars and more than 3 teaches', () => {
    expect(() => LevelSchema.parse(withOverrides({ title: 'x'.repeat(41) }))).toThrow();
    expect(() => LevelSchema.parse(withOverrides({ teaches: ['a', 'b', 'c', 'd'] }))).toThrow();
  });

  it('rejects duplicate objective ids and all-bonus objectives', () => {
    const dup = structuredClone(validLevelInput) as {
      objectives: { id: string }[];
    };
    dup.objectives[1]!.id = dup.objectives[0]!.id;
    expect(() => LevelSchema.parse(dup)).toThrow();

    const allBonus = structuredClone(validLevelInput) as {
      objectives: { bonus: boolean; optional: boolean }[];
    };
    for (const o of allBonus.objectives) {
      o.bonus = true;
    }
    expect(() => LevelSchema.parse(allBonus)).toThrow();
  });

  it('rejects a malformed level id', () => {
    expect(() => LevelSchema.parse(withOverrides({ id: 'level-one' }))).toThrow();
  });

  it.each([
    { coach: [{ when: { command_regex: '(' }, say: 'Try pwd' }] },
    { forbidden_commands: ['['] },
    {
      objectives: [
        {
          id: 'nested',
          text: 'Run pwd',
          check: { type: 'all', checks: [{ type: 'command_used', regex: '[' }] },
        },
      ],
    },
    { sandbox: { image: 'bad image' } },
    { setup: { files: [{ path: '/tmp/file', content: '', content_file: 'setup/data' }] } },
    { setup: { files: [{ path: '/tmp/file' }] } },
  ])('rejects invalid authoring input %j', (overrides) => {
    expect(LevelSchema.safeParse(withOverrides(overrides)).success).toBe(false);
  });

  it('accepts a file-content pattern with a secret placeholder', () => {
    expect(
      LevelSchema.safeParse(
        withOverrides({
          objectives: [
            {
              id: 'report',
              text: 'Write the report.',
              check: { type: 'file_content', path: '/tmp/report', matches: '^{{secret:key}}{2}$' },
            },
          ],
        }),
      ).success,
    ).toBe(true);
  });
});

describe('admin sandbox input validation (T10.1)', () => {
  it.each(['SYS_ADMIN', 'CAP_NET_RAW', 'ALL', 'NET_RAW\nSYS_ADMIN'])(
    'rejects an unsupported capability: %s',
    (capability) => {
      expect(() =>
        LevelSchema.parse(
          withOverrides({
            sandbox: {
              profile: 'admin',
              capabilities: [capability],
            },
          }),
        ),
      ).toThrow();
    },
  );
  it.each([
    '/usr/bin/cat\nplayer ALL=(ALL) ALL',
    '/usr/bin/cat, ALL',
    'ALL',
    '/usr/bin/cat *',
    '/usr/bin/cat /root/code: ALL',
    '/usr/bin/cat #comment',
    '/usr/bin/cat\n',
  ])('rejects sudoers syntax injection: %s', (command) => {
    expect(() =>
      LevelSchema.parse(
        withOverrides({
          sandbox: {
            profile: 'admin',
            sudo_allow: [command],
          },
        }),
      ),
    ).toThrow();
  });
  it('accepts literal command arguments and explicit network capabilities only for admin', () => {
    const sandbox = {
      profile: 'admin',
      capabilities: ['NET_RAW', 'NET_ADMIN'],
      sudo_allow: ['/usr/bin/cat /root/access-code.txt'],
    };
    expect(LevelSchema.parse(withOverrides({ sandbox })).sandbox).toMatchObject(sandbox);
    expect(() =>
      LevelSchema.parse(withOverrides({ sandbox: { ...sandbox, profile: 'basic' } })),
    ).toThrow();
  });
});
