import { toPublicLevel, type Level } from '@terminal-quest/shared';
import { createCoach } from '../engine/coach.js';
import { parseCmdlogLine } from '../engine/cmdlog.js';
import { createHintState, nextHint } from '../engine/hints.js';
import { createTracker, handleInboxLine, noteCommand } from '../engine/objectiveTracker.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';
import { openAttempt, saveAttemptHints } from '../progression/attempts.js';
import { recordEvent } from '../progression/events.js';
import { CapacityError, type Session } from '../sandbox/sessionManager.js';
import type { LiveSession } from './liveSession.js';
import { attemptScope, isActive, send, type FlowDeps } from './sessionContext.js';
import { scheduleEvaluation } from './sessionEvaluation.js';
import { createBudget, ResourceLimitError } from '../util/resourceLimits.js';
import { logger } from '../util/logger.js';
import { TERMINAL_BYTES_PER_SECOND } from './socketLimits.js';
import { closeLiveSession } from './sessionCleanup.js';
import { tuxStatus, tuxExplain } from './sessionMessages.js';
import { SessionReplay } from './sessionReplay.js';

export type { FlowDeps } from './sessionContext.js';
export { evaluateAndReport } from './sessionEvaluation.js';
export { closeLiveSession, type CloseReason } from './sessionCleanup.js';

// Live-session lifecycle shared by the session routes and the socket:
// launch (sandbox + setup + shell + watchers), evaluate-and-report (with
// completion persistence), hints, and closing.

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function requestHint(deps: FlowDeps, live: LiveSession): void {
  if (!isActive(deps, live) || live.attemptFinished) return;
  const hint = nextHint(live.level, live.hints);
  if (hint === undefined) {
    send(live, { t: 'error', message: 'no hints left' });
    return;
  }
  try {
    saveAttemptHints(deps.db, live.attemptId, live.hints.tiersUsed);
  } catch (err) {
    live.hints.tiersUsed.pop();
    logger.error({ err, ...attemptScope(live) }, 'failed to save hint');
    send(live, { t: 'error', message: 'could not save hint' });
    return;
  }
  send(live, { t: 'hint', tier: hint.tier, text: hint.text, penaltyPct: hint.penaltyPct });
  recordEvent(deps.db, {
    ...attemptScope(live),
    type: 'hint_used',
    payload: { tier: hint.tier },
  });
}

export async function launchLevelSession(
  deps: FlowDeps,
  userId: string,
  level: Level,
  levelDir: string,
  seed: number,
): Promise<LiveSession> {
  const sandboxAttemptId = `tq-${userId.slice(0, 8)}-${level.id}-s${seed}-${Date.now() % 100000}`;
  let session: Session;
  try {
    session = await deps.manager.create({
      attemptId: sandboxAttemptId,
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
      logger.error(
        { err, userId, levelId: level.id, attemptId: sandboxAttemptId },
        'sandbox creation failed',
      );
      recordEvent(deps.db, {
        userId,
        levelId: level.id,
        type: 'sandbox_error',
        payload: { stage: 'create' },
      });
    }
    throw err;
  }
  let live: LiveSession | undefined;
  let stage = 'setup';
  try {
    await runSetup(deps.provider, session.handle, compileSetup(level, levelDir, seed), seed);
    stage = 'attempt';
    const tracker = createTracker(level);
    const launching: LiveSession = {
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
      watchers: [],
      socket: undefined,
      completed: false,
      replay: new SessionReplay(),
      closed: false,
      dialogue: {
        welcomed: false,
        lastProgressAt: Date.now(),
        failsSinceProgress: 0,
        nudgedAt: null,
      },
    };
    live = launching;
    stage = 'shell';
    const shell = await deps.provider.openShell(session.handle, { cols: 80, rows: 24 });
    launching.shell = shell;
    let launched = false;
    let startupError: Error | undefined;
    const assertLaunching = (): void => {
      if (startupError !== undefined) throw startupError;
      if (deps.manager.get(session.id) !== session) throw new Error('sandbox closed during launch');
    };
    assertLaunching();
    const outputBudget = createBudget(TERMINAL_BYTES_PER_SECOND);
    const stopForFailure = (err: Error, source: string): void => {
      if (launching.closed) return;
      if (!launched) {
        startupError ??= err;
        return;
      }
      const limited = err instanceof ResourceLimitError;
      logger.warn({ err, source, ...attemptScope(launching) }, 'session runtime failed');
      send(launching, {
        t: 'error',
        message: limited
          ? 'session resource limit exceeded; start a new attempt'
          : 'terminal disconnected; start a new attempt',
      });
      void closeLiveSession(deps, launching, 'abandoned').catch((error: unknown) => {
        logger.error(
          { err: error, source, ...attemptScope(launching) },
          'runtime failure cleanup failed',
        );
      });
    };
    shell.onClose((err) => stopForFailure(err ?? new Error('shell closed unexpectedly'), 'shell'));
    assertLaunching();
    // Provider chunks are already UTF-8 boundary-safe (T1.2).
    shell.onData((chunk) => {
      if (launching.closed) return;
      if (!outputBudget.take(chunk.length)) {
        stopForFailure(new ResourceLimitError('terminal output rate'), 'shell');
        return;
      }
      launching.replay.write(chunk.toString('utf8'), (payload) => launching.socket?.send(payload));
    });
    stage = 'inbox';
    const inbox = await deps.provider.watchFile(
      session.handle,
      '/run/tq/inbox',
      (line) => {
        if (!isActive(deps, launching)) return;
        const cmd = handleInboxLine(tracker, line);
        if (cmd === 'hint') {
          requestHint(deps, launching);
        } else if (cmd === 'status') {
          send(launching, { t: 'tux', text: tuxStatus(launching) });
        } else if (typeof cmd === 'object' && cmd.kind === 'explain') {
          send(launching, { t: 'tux', text: tuxExplain(launching, cmd.text) });
        } else if (typeof cmd === 'object') {
          scheduleEvaluation(deps, launching);
        }
      },
      (err) => stopForFailure(err, 'inbox'),
    );
    launching.watchers.push(inbox);
    assertLaunching();
    stage = 'cmdlog';
    const cmdlog = await deps.provider.watchFile(
      session.handle,
      '/run/tq/cmdlog',
      (line) => {
        if (!isActive(deps, launching)) return;
        const entry = parseCmdlogLine(line);
        if (entry === undefined) {
          return;
        }
        noteCommand(tracker, entry);
        if (entry.exitCode !== 0) {
          launching.dialogue.failsSinceProgress += 1;
        }
        const tip = launching.coach.advise(entry.command, entry.exitCode);
        if (tip !== undefined) {
          send(launching, { t: 'coach', text: tip });
        }
        scheduleEvaluation(deps, launching);
      },
      (err) => stopForFailure(err, 'cmdlog'),
    );
    launching.watchers.push(cmdlog);
    assertLaunching();

    stage = 'event';
    deps.live.set(session.id, launching);
    recordEvent(deps.db, {
      ...attemptScope(launching),
      type: 'level_start',
      payload: { seed },
    });
    launched = true;
    return launching;
  } catch (err) {
    logger.error(
      {
        err,
        userId,
        levelId: level.id,
        attemptId: live?.attemptId ?? sandboxAttemptId,
        sessionId: session.id,
        stage,
      },
      'session launch failed',
    );
    try {
      recordEvent(deps.db, {
        userId,
        levelId: level.id,
        ...(live ? { attemptId: live.attemptId } : {}),
        type: 'sandbox_error',
        payload: { stage },
      });
    } catch (eventError) {
      logger.error({ err: eventError, userId, levelId: level.id }, 'launch error telemetry failed');
    }
    try {
      if (live !== undefined) await closeLiveSession(deps, live, 'abandoned');
      else await deps.manager.close(session.id, 'manual');
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError, userId, levelId: level.id, attemptId: live?.attemptId },
        'launch cleanup failed; sandbox retained for retry',
      );
    }
    throw err;
  }
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
