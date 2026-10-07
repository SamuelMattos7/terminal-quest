import type { Level } from '@terminal-quest/shared';
import { runCheck } from './checkRunner.js';
import type { CheckContext, LoggedCommand } from './checks/context.js';
import type { CmdlogEntry } from './cmdlog.js';
import type { SandboxHandle, SandboxProvider } from '../sandbox/provider.js';

// Objective tracking for plan.md §4.1: sticky objectives (once done they
// stay done, D-005) unless `hold: true`, which re-checks at completion.
// The socket layer (T3.2) calls evaluate() on cmdlog events and `check`
// messages, and turns newlyDone into `objective` WS frames.

export interface TrackerState {
  done: Map<string, boolean>;
  answers: string[];
  commands: LoggedCommand[];
}

export type InboxCommand = 'hint' | 'status' | 'unknown' | InboxSubmit | InboxExplain;

export interface InboxSubmit {
  kind: 'submit';
  text: string;
}

export interface InboxExplain {
  kind: 'explain';
  text: string;
}

export function createTracker(level: Level): TrackerState {
  return {
    done: new Map(level.objectives.map((o) => [o.id, false])),
    answers: [],
    commands: [],
  };
}

export function noteCommand(state: TrackerState, entry: CmdlogEntry): void {
  state.commands.push({ command: entry.command, exitCode: entry.exitCode });
}

export function submitAnswer(state: TrackerState, text: string): void {
  state.answers.push(text);
}

/**
 * Handle one JSON line from `/run/tq/inbox` (D-007). Player junk never
 * throws; unknown shapes report 'unknown' for the server to ignore
 * (rate-limiting that junk belongs to the socket layer, T3.2).
 */
export function handleInboxLine(state: TrackerState, line: string): InboxCommand | InboxSubmit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return 'unknown';
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return 'unknown';
  }
  const cmd = (parsed as { cmd?: unknown }).cmd;
  switch (cmd) {
    case 'hint':
    case 'status':
      return cmd;
    case 'explain': {
      const text = (parsed as { text?: unknown }).text;
      return typeof text === 'string' ? { kind: 'explain', text } : 'unknown';
    }
    case 'submit': {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text !== 'string') {
        return 'unknown';
      }
      submitAnswer(state, text);
      return { kind: 'submit', text };
    }
    default:
      return 'unknown';
  }
}

/** Objectives that gate level completion (neither bonus nor optional). */
export function requiredObjectives(level: Level): string[] {
  return level.objectives.filter((o) => !o.bonus && !o.optional).map((o) => o.id);
}

export interface EvaluateOptions {
  seed: number;
}

export interface EvaluateResult {
  newlyDone: string[];
  completed: boolean;
}

export async function evaluate(
  provider: SandboxProvider,
  handle: SandboxHandle,
  level: Level,
  state: TrackerState,
  opts: EvaluateOptions,
): Promise<EvaluateResult> {
  const ctx: CheckContext = {
    seed: opts.seed,
    levelId: level.id,
    answers: state.answers,
    commands: state.commands,
  };
  const newlyDone: string[] = [];
  for (const objective of level.objectives) {
    const wasDone = state.done.get(objective.id) ?? false;
    if (wasDone && !objective.hold) {
      continue;
    }
    const passed = await runCheck(provider, handle, objective.check, ctx);
    state.done.set(objective.id, passed);
    if (passed && !wasDone) {
      newlyDone.push(objective.id);
    }
  }
  const completed = requiredObjectives(level).every((id) => state.done.get(id) === true);
  return { newlyDone, completed };
}
