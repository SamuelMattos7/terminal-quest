import type { Level } from '@terminal-quest/shared';

// Hint tiers for plan.md §10.6. State is per attempt (fresh state on
// `reset`). Stuck-nudge detection belongs to the Tux dialogue system (T6.2).

export interface HintState {
  tiersUsed: number[];
}

export interface RevealedHint {
  tier: 1 | 2 | 3;
  text: string;
  penaltyPct: number;
}

const TIER_PENALTY_PCT: Record<number, number> = { 1: 5, 2: 10, 3: 25 };

export function createHintState(): HintState {
  return { tiersUsed: [] };
}

/** Reveal the next tier in 1→2→3 order; undefined when exhausted. */
export function nextHint(level: Level, state: HintState): RevealedHint | undefined {
  const tier = state.tiersUsed.length + 1;
  if (tier < 1 || tier > 3) {
    return undefined;
  }
  const text = level.hints[tier - 1];
  if (text === undefined) {
    return undefined;
  }
  state.tiersUsed.push(tier);
  return { tier: tier as 1 | 2 | 3, text, penaltyPct: TIER_PENALTY_PCT[tier] ?? 0 };
}
