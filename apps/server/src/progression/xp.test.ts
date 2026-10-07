import { describe, expect, it } from 'vitest';
import { playerLevel, xpForLevel, xpToNext } from './xp.js';

describe('xpForLevel', () => {
  it('follows round(100 * n^1.5)', () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(283);
    expect(xpForLevel(3)).toBe(520);
  });

  it('rejects non-positive integers', () => {
    expect(() => xpForLevel(0)).toThrow();
  });
});

describe('playerLevel', () => {
  it('starts at 1 and steps up at thresholds', () => {
    expect(playerLevel(0)).toBe(1);
    expect(playerLevel(99)).toBe(1);
    expect(playerLevel(100)).toBe(2);
    expect(playerLevel(282)).toBe(2);
    expect(playerLevel(283)).toBe(3);
  });
});

describe('xpToNext', () => {
  it('counts down to the next threshold', () => {
    expect(xpToNext(0)).toBe(100);
    expect(xpToNext(100)).toBe(183);
    expect(xpToNext(283)).toBe(237);
  });
});
