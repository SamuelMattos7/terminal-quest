import { eq } from 'drizzle-orm';
import { levelProgress } from '../db/schema.js';
import { countCommands } from '../engine/cmdlog.js';
import { checkManualBonus, computeScore } from '../engine/scoring.js';
import { evaluate, requiredObjectives } from '../engine/objectiveTracker.js';
import { levelStates } from '../progression/unlock.js';
import { HINT_NUDGE_TEXT, shouldNudge } from '../progression/dialogue.js';
import { wasReviewDue } from '../progression/review.js';
import { recordEvent } from '../progression/events.js';
import { recordLevelCompletion } from '../progression/progress.js';
import type { LiveSession } from './liveSession.js';
import { attemptScope, isActive, send, type FlowDeps } from './sessionContext.js';
import { logger } from '../util/logger.js';

function computeUnlocked(
  { levelsByWorld, unlockAll }: FlowDeps,
  done: Set<string>,
  justCompletedId: string,
): string[] {
  const before = levelStates(levelsByWorld, done, unlockAll);
  const after = levelStates(levelsByWorld, new Set([...done, justCompletedId]), unlockAll);
  const unlocked: string[] = [];
  for (const [id, state] of after) {
    const was = before.get(id);
    if (
      was !== 'available' &&
      was !== 'completed' &&
      (state === 'available' || state === 'completed')
    ) {
      unlocked.push(id);
    }
  }
  return unlocked.sort();
}

// One running evaluation plus a dirty bit. All callers share the drain
// promise, so a slow check cannot build an unbounded chain of closures.
const evaluations = new WeakMap<LiveSession, { dirty: boolean; pending: Promise<void> }>();
const observed = new WeakSet<Promise<void>>();

export function evaluateAndReport(deps: FlowDeps, live: LiveSession): Promise<void> {
  const current = evaluations.get(live);
  if (current) {
    current.dirty = true;
    return current.pending;
  }
  const state = { dirty: true, pending: Promise.resolve() };
  state.pending = Promise.resolve().then(async () => {
    try {
      while (state.dirty && isActive(deps, live) && !live.completed) {
        state.dirty = false;
        await runEvaluation(deps, live);
      }
    } finally {
      evaluations.delete(live);
    }
  });
  evaluations.set(live, state);
  return state.pending;
}

/** Watchers/socket events attach only one rejection handler per drain. */
export function scheduleEvaluation(deps: FlowDeps, live: LiveSession): void {
  const pending = evaluateAndReport(deps, live);
  if (observed.has(pending)) return;
  observed.add(pending);
  void pending.catch((err: unknown) => {
    logger.warn({ err, ...attemptScope(live) }, 'session evaluation failed');
    send(live, { t: 'error', message: 'evaluation failed' });
  });
}

async function runEvaluation(deps: FlowDeps, live: LiveSession): Promise<void> {
  if (!isActive(deps, live)) return;
  const { newlyDone } = await evaluate(
    deps.provider,
    live.session.handle,
    live.level,
    live.tracker,
    {
      seed: live.seed,
      onCheckTimeout: (objectiveId, checkType) => {
        if (!isActive(deps, live)) return;
        recordEvent(deps.db, {
          ...attemptScope(live),
          type: 'check_timeout',
          payload: { objectiveId, checkType },
        });
      },
    },
  );
  // A check may resolve after abandonment, replacement, expiry, or reset.
  // The manager removes an expiring session before awaiting Docker teardown.
  if (!isActive(deps, live)) return;
  for (const id of newlyDone) {
    send(live, { t: 'objective', id, status: 'done' });
    recordEvent(deps.db, {
      ...attemptScope(live),
      type: 'objective_complete',
      payload: { objectiveId: id },
    });
  }
  if (newlyDone.length > 0) {
    // Any progress ends the stuck episode (§10.6 idle nudge).
    live.dialogue.lastProgressAt = Date.now();
    live.dialogue.failsSinceProgress = 0;
    live.dialogue.nudgedAt = null;
  }
  if (live.completed) {
    return;
  }
  const required = requiredObjectives(live.level);
  const done = required.every((id) => live.tracker.done.get(id) === true);
  if (!done) {
    if (shouldNudge(live.dialogue)) {
      live.dialogue.nudgedAt = Date.now();
      send(live, { t: 'tux', text: HINT_NUDGE_TEXT });
    }
    return;
  }
  await deps.live.runForUser(live.userId, async () => {
    if (!isActive(deps, live)) return;
    const commands = live.tracker.commands.map((c) => c.command);
    const bonusDone = live.level.objectives
      .filter((o) => o.bonus && (live.tracker.done.get(o.id) ?? false))
      .map((o) => o.id);
    const rows = await deps.db
      .select()
      .from(levelProgress)
      .where(eq(levelProgress.userId, live.userId))
      .all();
    const best = rows.find((r) => r.levelId === live.level.id);
    const previouslyCompleted = new Set(
      rows.filter((r) => r.completions > 0).map((r) => r.levelId),
    );
    const isReviewReplay = await wasReviewDue(deps.db, live.userId, live.level, deps.levelsById);
    const score = computeScore({
      level: live.level,
      hintTiers: live.hints.tiersUsed,
      commandCount: countCommands(commands),
      bonusDoneIds: bonusDone,
      manualBonus: checkManualBonus(commands),
      isFirstClear: (best?.completions ?? 0) === 0,
      bestXp: best?.bestXp ?? 0,
      isReviewReplay,
    });
    // Async scoring reads above may have yielded to expiry/shutdown. The
    // active check and synchronous transaction below cannot be interleaved.
    if (!isActive(deps, live)) return;
    const { recorded, newBadges } = recordLevelCompletion(deps.db, {
      userId: live.userId,
      level: live.level,
      attemptId: live.attemptId,
      seed: live.seed,
      xpAwarded: score.xp,
      fullXp: score.fullXp,
      rank: score.rank,
      hintTiers: live.hints.tiersUsed,
      commands: live.tracker.commands,
      bonusDoneIds: bonusDone,
      teachesSkills: deps.skills,
      badgeList: deps.badgeList,
      levelsById: deps.levelsById,
      levelsByWorld: deps.levelsByWorld,
    });
    if (!recorded) return;
    live.completed = true;
    live.attemptFinished = true;
    const unlocked = computeUnlocked(deps, previouslyCompleted, live.level.id);
    send(live, {
      t: 'level_complete',
      result: {
        xp: score.xp,
        rank: score.rank,
        breakdown: score.breakdown,
        newBadges,
        unlocked,
        explain: live.level.explain,
        skillsGained: live.level.teaches,
        message: live.level.success_message,
      },
    });
    recordEvent(deps.db, {
      ...attemptScope(live),
      type: 'level_complete',
      payload: { xp: score.xp, rank: score.rank },
    });
  });
}
