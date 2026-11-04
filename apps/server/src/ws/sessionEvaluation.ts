import { eq } from 'drizzle-orm';
import { levelProgress } from '../db/schema.js';
import type { Db } from '../db/client.js';
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

async function completedIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.select().from(levelProgress).where(eq(levelProgress.userId, userId)).all();
  return new Set(rows.filter((r) => r.completions > 0).map((r) => r.levelId));
}

export async function computeUnlocked(
  deps: FlowDeps,
  userId: string,
  justCompletedId: string,
): Promise<string[]> {
  const done = await completedIds(deps.db, userId);
  const before = levelStates(deps.levelsByWorld, done, deps.unlockAll);
  done.add(justCompletedId);
  const after = levelStates(deps.levelsByWorld, done, deps.unlockAll);
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

// Evaluations for one session run strictly in order. Without this, two
// cmdlog lines landing together interleave two evaluations on the shared
// tracker (TOCTOU between the wasDone read and the done write) and both
// report the same objectives as newly done — duplicating objective frames,
// telemetry, and potentially completion handling (T6.3 caught this live).
const evalChains = new WeakMap<LiveSession, Promise<void>>();

export async function evaluateAndReport(deps: FlowDeps, live: LiveSession): Promise<void> {
  const previous = evalChains.get(live) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  evalChains.set(live, current);
  await previous;
  try {
    await runEvaluation(deps, live);
  } finally {
    release();
  }
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
    const unlocked = await computeUnlocked(deps, live.userId, live.level.id);
    if (!isActive(deps, live)) return;
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
