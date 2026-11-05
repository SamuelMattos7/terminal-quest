import {
  InboxMessageSchema,
  MAX_WATCH_LINE_BYTES,
  MAX_COMMANDS,
  MAX_ANSWERS,
  MAX_COMMAND_HISTORY_BYTES,
  MAX_ANSWER_HISTORY_BYTES,
  MAX_TEXT_BYTES,
  utf8Bytes,
  type Level,
} from '@terminal-quest/shared';
import { ResourceLimitError } from '../util/resourceLimits.js';
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
  commandBytes: number;
  answerBytes: number;
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
    commandBytes: 0,
    answerBytes: 0,
  };
}

export function noteCommand(state: TrackerState, entry: CmdlogEntry): void {
  const bytes = utf8Bytes(entry.command);
  if (
    bytes > MAX_TEXT_BYTES ||
    state.commands.length >= MAX_COMMANDS ||
    state.commandBytes + bytes > MAX_COMMAND_HISTORY_BYTES
  ) {
    throw new ResourceLimitError('command history');
  }
  state.commandBytes += bytes;
  state.commands.push({ command: entry.command, exitCode: entry.exitCode });
}

export function submitAnswer(state: TrackerState, text: string): void {
  const bytes = utf8Bytes(text);
  if (
    bytes > MAX_TEXT_BYTES ||
    state.answers.length >= MAX_ANSWERS ||
    state.answerBytes + bytes > MAX_ANSWER_HISTORY_BYTES
  ) {
    throw new ResourceLimitError('answer history');
  }
  state.answerBytes += bytes;
  state.answers.push(text);
}

/**
 * Handle one JSON line from `/run/tq/inbox` (D-007). Player junk never
 * throws; unknown shapes report 'unknown' for the server to ignore
 * (stream byte/line/rate budgets are enforced before this parser).
 */
export function handleInboxLine(state: TrackerState, line: string): InboxCommand | InboxSubmit {
  let parsed: unknown;
  if (utf8Bytes(line) > MAX_WATCH_LINE_BYTES) return 'unknown';
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return 'unknown';
  }
  const message = InboxMessageSchema.safeParse(parsed);
  if (!message.success) return 'unknown';
  const msg = message.data;
  switch (msg.cmd) {
    case 'hint':
    case 'status':
      return msg.cmd;
    case 'explain': {
      return { kind: 'explain', text: msg.text };
    }
    case 'submit': {
      submitAnswer(state, msg.text);
      return { kind: 'submit', text: msg.text };
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
  onCheckTimeout?: (objectiveId: string, checkType: string) => void;
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
  const newlyDone: string[] = [];
  for (const objective of level.objectives) {
    const wasDone = state.done.get(objective.id) ?? false;
    if (wasDone && !objective.hold) {
      continue;
    }
    const ctx: CheckContext = {
      seed: opts.seed,
      levelId: level.id,
      answers: state.answers,
      commands: state.commands,
      onTimeout:
        opts.onCheckTimeout === undefined
          ? undefined
          : (checkType) => opts.onCheckTimeout?.(objective.id, checkType),
    };
    const passed = await runCheck(provider, handle, objective.check, ctx);
    state.done.set(objective.id, passed);
    if (passed && !wasDone) {
      newlyDone.push(objective.id);
    }
  }
  const completed = requiredObjectives(level).every((id) => state.done.get(id) === true);
  return { newlyDone, completed };
}
