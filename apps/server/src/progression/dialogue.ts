// Tux-9000 dialogue state and rules (T6.2): session intro, idle nudge
// (plan.md §10.6). Completion lines travel as level `success_message`.
// The nudge only ever suggests the hint button — tiers are never revealed.

export const STUCK_MS = 3 * 60 * 1000;
export const FAILS_FOR_NUDGE = 3;

export const HINT_NUDGE_TEXT =
  "Stuck? There's no shame in a hint — click the hint button. There's a small XP tax.";

export interface NudgeState {
  lastProgressAt: number;
  failsSinceProgress: number;
  nudgedAt: number | null;
}

export function shouldNudge(state: NudgeState, now = Date.now()): boolean {
  if (state.nudgedAt !== null) {
    return false;
  }
  return state.failsSinceProgress >= FAILS_FOR_NUDGE && now - state.lastProgressAt >= STUCK_MS;
}

export function tuxIntro(title: string, requiredCount: number): string {
  const objectives = requiredCount === 1 ? '1 objective' : `${requiredCount} objectives`;
  return `Tux-9000: ${title} — ${objectives}. Type 'tux status' any time. No, I won't do it for you.`;
}
