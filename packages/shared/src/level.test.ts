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
});
