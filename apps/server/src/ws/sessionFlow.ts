import { eq } from 'drizzle-orm';
import {
  toPublicLevel,
  type CoachRule,
  type Level,
  type ServerMessage,
  type Skill,
} from '@terminal-quest/shared';
import { levelProgress } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { createCoach } from '../engine/coach.js';
import { countCommands, parseCmdlogLine } from '../engine/cmdlog.js';
import { checkManualBonus, computeScore } from '../engine/scoring.js';
import { createHintState, nextHint } from '../engine/hints.js';
import {
  createTracker,
  evaluate,
  handleInboxLine,
  noteCommand,
  requiredObjectives,
} from '../engine/objectiveTracker.js';
import { compileSetup } from '../engine/setupCompiler.js';
import { runSetup } from '../engine/setupRunner.js';
import { levelStates } from '../progression/unlock.js';
import { endAttempt, openAttempt } from '../progression/attempts.js';
import { recordLevelCompletion } from '../progression/progress.js';
import type { Badge } from '../progression/badges.js';
import { SessionManager } from '../sandbox/sessionManager.js';
import type { SandboxProvider } from '../sandbox/provider.js';
import { LiveSessionRegistry, type LiveSession } from './liveSession.js';

// Live-session lifecycle shared by the session routes and the socket:
// launch (sandbox + setup + shell + watchers), evaluate-and-report (with
// completion persistence), hints, and closing.

export interface FlowDeps {
  provider: SandboxProvider;
  manager: SessionManager;
  live: LiveSessionRegistry;
  coachRules: CoachRule[];
  badgeList: Badge[];
  skills: Map<string, Skill>;
  db: Db;
  levelsByWorld: Map<number, Level[]>;
  levelsById: Map<string, Level>;
  unlockAll: boolean;
}

export type CloseReason = 'replaced' | 'abandoned' | 'idle' | 'max_age' | 'server_shutdown';

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

function send(live: LiveSession, msg: ServerMessage): void {
  live.socket?.send(JSON.stringify(msg));
}

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

export async function evaluateAndReport(deps: FlowDeps, live: LiveSession): Promise<void> {
  const { newlyDone } = await evaluate(
    deps.provider,
    live.session.handle,
    live.level,
    live.tracker,
    {
      seed: live.seed,
    },
  );
  for (const id of newlyDone) {
    send(live, { t: 'objective', id, status: 'done' });
  }
  if (live.completed) {
    return;
  }
  const required = requiredObjectives(live.level);
  const done = required.every((id) => live.tracker.done.get(id) === true);
  if (!done) {
    return;
  }
  live.completed = true;
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
  const score = computeScore({
    level: live.level,
    hintTiers: live.hints.tiersUsed,
    commandCount: countCommands(commands),
    bonusDoneIds: bonusDone,
    manualBonus: checkManualBonus(commands),
    isFirstClear: (best?.completions ?? 0) === 0,
    bestXp: best?.bestXp ?? 0,
  });
  const { newBadges } = await recordLevelCompletion(deps.db, {
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
  live.attemptFinished = true;
  send(live, {
    t: 'level_complete',
    result: {
      xp: score.xp,
      rank: score.rank,
      breakdown: score.breakdown,
      newBadges,
      unlocked: await computeUnlocked(deps, live.userId, live.level.id),
      explain: live.level.explain,
      skillsGained: live.level.teaches,
    },
  });
}

export function requestHint(live: LiveSession): void {
  const hint = nextHint(live.level, live.hints);
  if (hint === undefined) {
    send(live, { t: 'error', message: 'no hints left' });
    return;
  }
  send(live, { t: 'hint', tier: hint.tier, text: hint.text, penaltyPct: hint.penaltyPct });
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
  const session = await deps.manager.create({
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
  };

  const shell = await deps.provider.openShell(session.handle, { cols: 80, rows: 24 });
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
    const cmd = handleInboxLine(tracker, line);
    if (cmd === 'hint') {
      requestHint(live);
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
    const entry = parseCmdlogLine(line);
    if (entry === undefined) {
      return;
    }
    noteCommand(tracker, entry);
    const tip = live.coach.advise(entry.command, entry.exitCode);
    if (tip !== undefined) {
      send(live, { t: 'coach', text: tip });
    }
    void evaluateAndReport(deps, live).catch(() => undefined);
  });
  void cmdlog;

  const replaced = deps.live.set(session.id, live);
  void replaced;
  return live;
}

export async function closeLiveSession(
  deps: FlowDeps,
  live: LiveSession,
  reason: CloseReason,
): Promise<void> {
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
