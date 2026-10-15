import { describe, expect, it } from 'vitest';
import { FAILS_FOR_NUDGE, STUCK_MS, shouldNudge, tuxIntro, type NudgeState } from './dialogue.js';

function stuck(overrides: Partial<NudgeState> = {}): NudgeState {
  return {
    lastProgressAt: 0,
    failsSinceProgress: FAILS_FOR_NUDGE,
    nudgedAt: null,
    ...overrides,
  };
}

describe('shouldNudge', () => {
  it('fires at the stuck boundary (3 min, 3 fails)', () => {
    expect(shouldNudge(stuck(), STUCK_MS)).toBe(true);
  });

  it('stays silent below either threshold', () => {
    expect(shouldNudge(stuck({ failsSinceProgress: FAILS_FOR_NUDGE - 1 }), STUCK_MS)).toBe(false);
    expect(shouldNudge(stuck(), STUCK_MS - 1)).toBe(false);
  });

  it('fires only once per stuck episode', () => {
    expect(shouldNudge(stuck({ nudgedAt: STUCK_MS + 1 }), STUCK_MS * 10)).toBe(false);
  });

  it('fires again after progress resets the episode', () => {
    expect(
      shouldNudge({ lastProgressAt: 1000, failsSinceProgress: 3, nudgedAt: null }, 1000 + STUCK_MS),
    ).toBe(true);
  });
});

describe('tuxIntro', () => {
  it('counts required objectives with singular/plural', () => {
    expect(tuxIntro('Where Am I?', 3)).toContain('3 objectives');
    expect(tuxIntro('First Words', 1)).toContain('1 objective');
    expect(tuxIntro('First Words', 1)).not.toContain('1 objectives');
  });
});
