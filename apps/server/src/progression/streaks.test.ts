import { describe, expect, it } from 'vitest';
import { dayString, nextStreakDays } from './streaks.js';

describe('dayString', () => {
  it('formats UTC days', () => {
    expect(dayString(Date.parse('2026-10-07T03:00:00Z'))).toBe('2026-10-07');
  });
});

describe('nextStreakDays', () => {
  it('starts, continues, holds, and resets', () => {
    expect(nextStreakDays(0, null, '2026-10-07')).toBe(1);
    expect(nextStreakDays(2, '2026-10-06', '2026-10-07')).toBe(3);
    expect(nextStreakDays(2, '2026-10-07', '2026-10-07')).toBe(2);
    expect(nextStreakDays(5, '2026-10-05', '2026-10-07')).toBe(1);
  });

  it('handles month boundaries', () => {
    expect(nextStreakDays(1, '2026-09-30', '2026-10-01')).toBe(2);
  });
});
