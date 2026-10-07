import type { CoachRule } from '@terminal-quest/shared';

// Error coach for plan.md §10.7. Matches (exit code, command) against the
// level's rules first, then the global coach.yaml rules. At most one message
// per 20 s; the same rule fires at most twice per attempt.

export const COACH_THROTTLE_MS = 20_000;
const MAX_PER_RULE = 2;

export interface Coach {
  advise(command: string, exitCode: number): string | undefined;
}

export function createCoach(
  globalRules: CoachRule[],
  levelRules: CoachRule[] = [],
  now: () => number = Date.now,
): Coach {
  const rules = [...levelRules, ...globalRules];
  const hits = new Map<number, number>();
  let lastSentAt = -Infinity;

  function matches(rule: CoachRule, command: string, exitCode: number): boolean {
    if (rule.when.exit_code !== undefined && rule.when.exit_code !== exitCode) {
      return false;
    }
    if (
      rule.when.command_regex !== undefined &&
      !new RegExp(rule.when.command_regex).test(command)
    ) {
      return false;
    }
    return true;
  }

  return {
    advise(command: string, exitCode: number): string | undefined {
      const at = now();
      if (at - lastSentAt < COACH_THROTTLE_MS) {
        return undefined;
      }
      const index = rules.findIndex((rule) => matches(rule, command, exitCode));
      if (index < 0) {
        return undefined;
      }
      const used = hits.get(index) ?? 0;
      if (used >= MAX_PER_RULE) {
        return undefined;
      }
      hits.set(index, used + 1);
      lastSentAt = at;
      return rules[index]?.say;
    },
  };
}
