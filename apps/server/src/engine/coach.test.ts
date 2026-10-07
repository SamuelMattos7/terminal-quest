import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { CoachRuleSchema, type CoachRule } from '@terminal-quest/shared';
import { createCoach } from './coach.js';

const globalRules: CoachRule[] = [
  { when: { exit_code: 127 }, say: 'global: not found' },
  { when: { exit_code: 1, command_regex: '^rm\\b' }, say: 'global: rm' },
];

const levelRules: CoachRule[] = [
  { when: { exit_code: 1, command_regex: '^rm\\b' }, say: 'level: rm' },
];

describe('createCoach', () => {
  it('prefers level rules over global ones', () => {
    expect(createCoach(globalRules, levelRules).advise('rm -rf x', 1)).toBe('level: rm');
  });

  it('falls back to global rules', () => {
    expect(createCoach(globalRules).advise('frobnicate', 127)).toBe('global: not found');
    expect(createCoach(globalRules).advise('ls /nope', 0)).toBeUndefined();
  });

  it('throttles to one message per 20 s', () => {
    let now = 1_000_000;
    const coach = createCoach(globalRules, [], () => now);
    expect(coach.advise('frobnicate', 127)).toBe('global: not found');
    now += 19_999;
    expect(coach.advise('frobnicate', 127)).toBeUndefined();
    now += 1;
    expect(coach.advise('frobnicate', 127)).toBe('global: not found');
  });

  it('repeats the same rule at most twice per attempt, independently per rule', () => {
    let now = 1_000_000;
    const coach = createCoach(globalRules, [], () => now);
    const tick = (): string | undefined => {
      now += 20_000;
      return coach.advise('frobnicate', 127);
    };
    expect(tick()).toBe('global: not found');
    expect(tick()).toBe('global: not found');
    expect(tick()).toBeUndefined();
    // A different rule still fires.
    expect(coach.advise('rm -rf x', 1)).toBe('global: rm');
  });
});

describe('coach.yaml', () => {
  it('parses the shipped global rules', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolve(here, '..', '..', '..', '..', 'packages', 'levels', 'coach.yaml');
    const raw = parseYaml(readFileSync(file, 'utf8')) as unknown;
    const rules = z.array(CoachRuleSchema).parse(raw);
    expect(rules).toHaveLength(10);
    expect(createCoach(rules).advise('nope', 127)).toContain('command not found');
  });
});
