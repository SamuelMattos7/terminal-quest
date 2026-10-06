import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, toPublicLevel } from './api.js';
import { LevelSchema } from './level.js';
import { validLevelInput } from './test-fixtures.js';

describe('HealthResponseSchema', () => {
  it('accepts a valid /healthz payload', () => {
    expect(HealthResponseSchema.parse({ ok: true, docker: false })).toEqual({
      ok: true,
      docker: false,
    });
  });

  it('rejects a payload missing docker', () => {
    expect(() => HealthResponseSchema.parse({ ok: true })).toThrow();
  });
});

describe('toPublicLevel', () => {
  it('maps level fields to the public DTO', () => {
    const level = LevelSchema.parse(validLevelInput);
    expect(toPublicLevel(level)).toEqual({
      id: 'w1-02-where-am-i',
      title: 'Where Am I?',
      story: level.story,
      kind: 'lesson',
      objectives: [
        { id: 'ran-pwd', text: expect.any(String), optional: false, bonus: false },
        { id: 'ran-ls', text: expect.any(String), optional: false, bonus: false },
        { id: 'found-word', text: expect.any(String), optional: false, bonus: false },
      ],
      teaches: ['pwd', 'ls'],
      parCommands: 3,
      xp: 50,
      hintCount: 3,
    });
  });

  it('never leaks checks, setup, solutions, or hint text (hard rule 1)', () => {
    const level = LevelSchema.parse(validLevelInput);
    const leaked = JSON.stringify(toPublicLevel(level));
    expect(leaked).not.toContain('/opt/tq/secret');
    expect(leaked).not.toContain('solution.sh');
    expect(leaked).not.toContain('welcome-banana');
    const keys = new Set<string>();
    JSON.parse(leaked, (k: string, v: unknown) => {
      keys.add(k);
      return v as unknown;
    });
    for (const forbidden of ['check', 'setup', 'solutions', 'hints', 'from_file']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
