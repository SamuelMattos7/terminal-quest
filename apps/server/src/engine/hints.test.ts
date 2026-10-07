import { describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import { createHintState, nextHint } from './hints.js';

function makeLevel(): Level {
  return LevelSchema.parse({
    id: 'w1-02-where-am-i',
    world: 1,
    order: 2,
    title: 'Where Am I?',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 4,
    story: 'A short story.',
    teaches: ['pwd'],
    par_commands: 4,
    xp: 100,
    objectives: [
      { id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/home/player/a.txt' } },
    ],
    hints: ['nudge', 'flag', 'solution'],
    success_message: 'Done.',
    solutions: { reference: 'solution.sh' },
  });
}

describe('nextHint', () => {
  it('reveals tiers in order with penalties, then exhausts', () => {
    const level = makeLevel();
    const state = createHintState();
    expect(nextHint(level, state)).toEqual({ tier: 1, text: 'nudge', penaltyPct: 5 });
    expect(nextHint(level, state)).toEqual({ tier: 2, text: 'flag', penaltyPct: 10 });
    expect(nextHint(level, state)).toEqual({ tier: 3, text: 'solution', penaltyPct: 25 });
    expect(nextHint(level, state)).toBeUndefined();
    expect(state.tiersUsed).toEqual([1, 2, 3]);
  });
});
