import type { Level } from '@terminal-quest/shared';
import { countCommands } from './cmdlog.js';

// XP and rank math for plan.md §10.1.

export type Rank = 'S' | 'A' | 'B' | 'C';

export interface ScoreInput {
  level: Level;
  /** Tiers already revealed (each 1, 2, or 3). */
  hintTiers: number[];
  commandCount: number;
  bonusDoneIds: string[];
  manualBonus: boolean;
  isFirstClear: boolean;
  bestXp: number;
}

export interface ScoreBreakdownEntry {
  label: string;
  xp: number;
}

export interface ScoreResult {
  /** XP actually awarded (after repeat-completion adjustment). */
  xp: number;
  /** Unadjusted single-run total; the new bestXp when higher. */
  fullXp: number;
  rank: Rank;
  breakdown: ScoreBreakdownEntry[];
}

const TIER_PENALTY: Record<number, number> = { 1: 5, 2: 10, 3: 25 };
const MAX_PENALTY_PCT = 40;
const MANUAL_BONUS = 5;
const BONUS_OBJECTIVE_XP = 10;

export function hintPenaltyPct(tiers: number[]): number {
  const total = tiers.reduce((sum, t) => sum + (TIER_PENALTY[t] ?? 0), 0);
  return Math.min(MAX_PENALTY_PCT, total);
}

const MANUAL_RE = /(^|\s)(man|tldr)(\s|$)|--help|((^|\s)-h(\s|$))/;

export function checkManualBonus(commands: string[]): boolean {
  return commands.some((c) => MANUAL_RE.test(c));
}

export function computeRank(
  level: Level,
  hintsUsed: number,
  commandCount: number,
  allBonusDone: boolean,
): Rank {
  if (hintsUsed === 0 && commandCount <= 1.5 * level.par_commands && allBonusDone) {
    return 'S';
  }
  if (hintsUsed <= 1 && commandCount <= 2 * level.par_commands) {
    return 'A';
  }
  if (hintsUsed <= 3) {
    return 'B';
  }
  return 'C';
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { level } = input;
  const penalty = hintPenaltyPct(input.hintTiers);
  const discounted = Math.round(level.xp * (1 - penalty / 100));
  const firstClearBonus = input.isFirstClear ? Math.round(level.xp * 0.1) : 0;
  const manual = input.manualBonus ? MANUAL_BONUS : 0;
  const bonusXp = input.bonusDoneIds.length * BONUS_OBJECTIVE_XP;

  const breakdown: ScoreBreakdownEntry[] = [{ label: 'base', xp: discounted }];
  if (penalty > 0) {
    breakdown.push({ label: `hints (-${penalty}%)`, xp: discounted - level.xp });
  }
  if (firstClearBonus > 0) {
    breakdown.push({ label: 'first clear', xp: firstClearBonus });
  }
  if (manual > 0) {
    breakdown.push({ label: 'manual', xp: manual });
  }
  if (bonusXp > 0) {
    breakdown.push({ label: `bonus objectives ×${input.bonusDoneIds.length}`, xp: bonusXp });
  }

  const fullXp = discounted + firstClearBonus + manual + bonusXp;
  const awarded = input.isFirstClear ? fullXp : Math.max(0, fullXp - input.bestXp);
  if (!input.isFirstClear && awarded < fullXp) {
    breakdown.push({ label: 'repeat adjustment', xp: awarded - fullXp });
  }

  const bonusIds = new Set(input.bonusDoneIds);
  const allBonusDone = level.objectives.filter((o) => o.bonus).every((o) => bonusIds.has(o.id));
  const rank = computeRank(level, input.hintTiers.length, input.commandCount, allBonusDone);
  return { xp: awarded, fullXp: fullXp, rank, breakdown };
}

/** Derives manualBonus + commandCount from a cmdlog command list. */
export function computeScoreWithCommands(
  input: Omit<ScoreInput, 'commandCount' | 'manualBonus'> & { commands: string[] },
): ScoreResult {
  const { commands, ...rest } = input;
  return computeScore({
    ...rest,
    commandCount: countCommands(commands),
    manualBonus: checkManualBonus(commands),
  });
}
