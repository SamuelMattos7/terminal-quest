import { describe, expect, it } from 'vitest';
import type { Level } from '@terminal-quest/shared';
import { levelStates } from './unlock.js';

function level(
  id: string,
  world: number,
  order: number,
  kind: 'lesson' | 'boss' = 'lesson',
): Level {
  return {
    id,
    world,
    order,
    title: id,
    kind,
    difficulty: 1,
    estimated_minutes: 3,
    story: 'story',
    teaches: ['pwd'],
    par_commands: 2,
    xp: 50,
    sandbox: {
      profile: 'basic',
      network: 'none',
      sidecars: [],
      image: 'tq-base',
      start_cwd: '/home/player',
      resources: { memory_mb: 256, cpus: 0.5, pids: 128 },
      capabilities: [],
      sudo_allow: [],
      needs_cron: true,
    },
    objectives: [],
    hints: ['a', 'b', 'c'],
    coach: [],
    explain: [],
    cheatsheet: [],
    success_message: 'done',
    forbidden_commands: [],
    solutions: { reference: 'solution.sh', wrong: [] },
  };
}

const tree = new Map([
  [1, [level('w1-01-a', 1, 1), level('w1-02-b', 1, 2), level('w1-03-boss', 1, 3, 'boss')]],
  [2, [level('w2-01-a', 2, 1)]],
]);

describe('levelStates', () => {
  it('opens the first W1 level and locks the rest', () => {
    const states = levelStates(tree, new Set(), false);
    expect(states.get('w1-01-a')).toBe('available');
    expect(states.get('w1-02-b')).toBe('locked');
    expect(states.get('w2-01-a')).toBe('locked');
  });

  it('advances within a world on completion', () => {
    const states = levelStates(tree, new Set(['w1-01-a']), false);
    expect(states.get('w1-01-a')).toBe('completed');
    expect(states.get('w1-02-b')).toBe('available');
    expect(states.get('w2-01-a')).toBe('locked');
  });

  it('opens the next world only when its boss is done', () => {
    const noBoss = levelStates(tree, new Set(['w1-01-a', 'w1-02-b']), false);
    expect(noBoss.get('w2-01-a')).toBe('locked');
    const withBoss = levelStates(tree, new Set(['w1-01-a', 'w1-02-b', 'w1-03-boss']), false);
    expect(withBoss.get('w2-01-a')).toBe('available');
  });

  it('unlocks everything with UNLOCK_ALL', () => {
    const states = levelStates(tree, new Set(), true);
    expect(states.get('w1-02-b')).toBe('available');
    expect(states.get('w2-01-a')).toBe('available');
  });
});
