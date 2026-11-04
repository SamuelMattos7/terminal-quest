import { toPublicLevel, type Level } from '@terminal-quest/shared';
import { createCoach } from '../engine/coach.js';
import { parseCmdlogLine } from '../engine/cmdlog.js';
import { createHintState, nextHint } from '../engine/hints.js';
import { createTracker, handleInboxLine, noteCommand } from '../engine/objectiveTracker.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';
import { endAttempt, openAttempt } from '../progression/attempts.js';
import { recordEvent } from '../progression/events.js';
import { CapacityError, type Session } from '../sandbox/sessionManager.js';
import type { ShellStream } from '../sandbox/provider.js';
import type { LiveSession } from './liveSession.js';
import { attemptScope, isActive, send, type FlowDeps } from './sessionContext.js';
import { evaluateAndReport } from './sessionEvaluation.js';

export type { FlowDeps } from './sessionContext.js';
export { evaluateAndReport, computeUnlocked } from './sessionEvaluation.js';

// Live-session lifecycle shared by the session routes and the socket:
// launch (sandbox + setup + shell + watchers), evaluate-and-report (with
// completion persistence), hints, and closing.

export type CloseReason = 'replaced' | 'abandoned' | 'idle' | 'max_age' | 'server_shutdown';

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function requestHint(deps: FlowDeps, live: LiveSession): void {
  if (!isActive(deps, live)) return;
  const hint = nextHint(live.level, live.hints);
  if (hint === undefined) {
    send(live, { t: 'error', message: 'no hints left' });
    return;
  }
  send(live, { t: 'hint', tier: hint.tier, text: hint.text, penaltyPct: hint.penaltyPct });
  recordEvent(deps.db, {
    ...attemptScope(live),
    type: 'hint_used',
    payload: { tier: hint.tier },
  });
}

function tuxStatus(live: LiveSession): string {
  const total = live.level.objectives.length;
  const done = live.level.objectives.filter((o) => live.tracker.done.get(o.id) === true).length;
  return `Tux-9000: ${done}/${total} objectives done. Hints used: ${live.hints.tiersUsed.length}/3.`;
}

function tuxExplain(live: LiveSession, text: string): string {
  const query = text.trim().split(/\s+/)[0] ?? '';
  const card =
    live.level.explain.find((c) => c.command === text.trim()) ??
    live.level.explain.find((c) => c.command.startsWith(query));
  if (card === undefined) {
    return `Tux-9000: I have nothing filed under '${query}'. Try \`tldr ${query}\` in the shell.`;
  }
  const parts = card.parts.map((p) => `${p.token}: ${p.meaning}`).join(' / ');
  return `Tux-9000: ${card.command} — ${parts}`;
}

export async function launchLevelSession(
  deps: FlowDeps,
  userId: string,
  level: Level,
  levelDir: string,
  seed: number,
): Promise<LiveSession> {
  let session: Session;
  try {
    session = await deps.manager.create({
      attemptId: `tq-${userId.slice(0, 8)}-${level.id}-s${seed}-${Date.now() % 100000}`,
      userId,
      levelId: level.id,
      image: level.sandbox.image,
      profile: level.sandbox.profile,
      network: 'none',
      sidecars: [],
      resources: {
        memoryMb: level.sandbox.resources.memory_mb,
        cpus: level.sandbox.resources.cpus,
        pids: level.sandbox.resources.pids,
      },
      startCwd: level.sandbox.start_cwd,
      env: {},
    });
  } catch (err) {
    // Capacity rejections have their own 429 path; anything else is infra.
    if (!(err instanceof CapacityError)) {
      recordEvent(deps.db, {
        userId,
        levelId: level.id,
        type: 'sandbox_error',
        payload: { stage: 'create' },
      });
    }
    throw err;
  }
  try {
    await runSetup(deps.provider, session.handle, compileSetup(level, levelDir, seed), seed);
  } catch (err) {
    await deps.manager.close(session.id, 'manual');
    throw err;
  }

  const tracker = createTracker(level);
  const live: LiveSession = {
    session,
    userId,
    level,
    seed,
    attemptId: openAttempt(deps.db, userId, level.id, seed),
    attemptFinished: false,
    tracker,
    hints: createHintState(),
    coach: createCoach(deps.coachRules, level.coach),
    shell: undefined,
    socket: undefined,
    completed: false,
    closed: false,
    dialogue: {
      welcomed: false,
      lastProgressAt: Date.now(),
      failsSinceProgress: 0,
      nudgedAt: null,
    },
  };

  let shell: ShellStream;
  try {
    shell = await deps.provider.openShell(session.handle, { cols: 80, rows: 24 });
  } catch (err) {
    recordEvent(deps.db, {
      userId,
      levelId: level.id,
      attemptId: live.attemptId,
      type: 'sandbox_error',
      payload: { stage: 'shell' },
    });
    await deps.manager.close(session.id, 'manual');
    throw err;
  }
  live.shell = shell;
  // Provider chunks are already UTF-8 boundary-safe (T1.2); forward them.
  // send() no-ops while no socket is attached, so this is wired once here.
  shell.onData((chunk) => {
    const text = chunk.toString('utf8');
    if (text !== '') {
      send(live, { t: 'stdout', d: text });
    }
  });
  const inbox = await deps.provider.watchFile(session.handle, '/run/tq/inbox', (line) => {
    if (!isActive(deps, live)) return;
    const cmd = handleInboxLine(tracker, line);
    if (cmd === 'hint') {
      requestHint(deps, live);
    } else if (cmd === 'status') {
      send(live, { t: 'tux', text: tuxStatus(live) });
    } else if (typeof cmd === 'object' && cmd.kind === 'explain') {
      send(live, { t: 'tux', text: tuxExplain(live, cmd.text) });
    } else if (typeof cmd === 'object') {
      void evaluateAndReport(deps, live).catch(() => undefined);
    }
  });
  void inbox;
  const cmdlog = await deps.provider.watchFile(session.handle, '/run/tq/cmdlog', (line) => {
    if (!isActive(deps, live)) return;
    const entry = parseCmdlogLine(line);
    if (entry === undefined) {
      return;
    }
    noteCommand(tracker, entry);
    if (entry.exitCode !== 0) {
      live.dialogue.failsSinceProgress += 1;
    }
    const tip = live.coach.advise(entry.command, entry.exitCode);
    if (tip !== undefined) {
      send(live, { t: 'coach', text: tip });
    }
    void evaluateAndReport(deps, live).catch(() => undefined);
  });
  void cmdlog;

  const replaced = deps.live.set(session.id, live);
  void replaced;
  recordEvent(deps.db, {
    ...attemptScope(live),
    type: 'level_start',
    payload: { seed },
  });
  return live;
}

export async function closeLiveSession(
  deps: FlowDeps,
  live: LiveSession,
  reason: CloseReason,
): Promise<void> {
  live.closed = true;
  send(live, { t: 'closing', reason });
  live.socket?.close();
  live.socket = undefined;
  try {
    live.shell?.close();
  } catch {
    // Best effort: container teardown kills the shell regardless.
  }
  live.shell = undefined;
  deps.live.delete(live.session.id);
  if (!live.attemptFinished) {
    endAttempt(deps.db, live.attemptId, 'abandoned');
    live.attemptFinished = true;
  }
  if (reason === 'abandoned') {
    recordEvent(deps.db, { ...attemptScope(live), type: 'level_abandon' });
  }
  await deps.manager.close(live.session.id, 'manual');
}

export function sessionStateMessage(live: LiveSession): {
  level: ReturnType<typeof toPublicLevel>;
  objectives: { id: string; status: 'pending' | 'done' }[];
  hintsUsed: number;
  completed: boolean;
} {
  return {
    level: toPublicLevel(live.level),
    objectives: live.level.objectives.map((o) => ({
      id: o.id,
      status: (live.tracker.done.get(o.id) === true ? 'done' : 'pending') as 'pending' | 'done',
    })),
    hintsUsed: live.hints.tiersUsed.length,
    completed: live.completed,
  };
}
