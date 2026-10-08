import { describe, expect, it } from 'vitest';
import { reviewDue } from './review.js';

describe('reviewDue', () => {
  it('lists skills past their interval with a completed teaching level', () => {
    const day = 86_400_000;
    const teaches = new Map([
      ['w1-01-a', ['pwd']],
      ['w1-02-b', ['ls']],
    ]);
    const due = reviewDue(
      [
        { skillId: 'pwd', uses: 1, lastUsedAt: 0, levelsUsed: ['w1-01-a'] },
        { skillId: 'ls', uses: 1, lastUsedAt: 0, levelsUsed: ['w1-02-b'] },
      ],
      teaches,
      new Set(['w1-01-a', 'w1-02-b']),
      31 * day,
    );
    expect(due).toEqual([
      { skillId: 'pwd', levelId: 'w1-01-a' },
      { skillId: 'ls', levelId: 'w1-02-b' },
    ]);
  });

  it('skips fresh skills and skills with no completed teaching level', () => {
    const day = 86_400_000;
    const due = reviewDue(
      [
        { skillId: 'pwd', uses: 1, lastUsedAt: 29 * day, levelsUsed: ['w1-01-a'] },
        { skillId: 'ghost', uses: 1, lastUsedAt: 0, levelsUsed: [] },
      ],
      new Map([['w1-01-a', ['pwd']]]),
      new Set(['w1-01-a']),
      30 * day,
    );
    expect(due).toEqual([]);
  });
});
