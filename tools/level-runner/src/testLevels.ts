import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Level } from '@terminal-quest/shared';
import { compileSetup } from '@terminal-quest/server/engine/setupCompiler';
import { runSetup } from '@terminal-quest/server/engine/setupRunner';
import {
  createTracker,
  evaluate,
  handleInboxLine,
  noteCommand,
  type TrackerState,
} from '@terminal-quest/server/engine/objectiveTracker';
import { parseCmdlogLine } from '@terminal-quest/server/engine/cmdlog';
import { DockerProvider } from '@terminal-quest/server/sandbox/dockerProvider';
import type {
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
} from '@terminal-quest/server/sandbox/provider';

// Content test harness for plan.md §12.4: per level and seed, prove the
// baseline cannot complete, no wrong solution completes, and the reference
// solution completes (bonus reported, not gated).

export interface PhaseResult {
  phase: 'baseline' | 'wrong' | 'reference';
  label: string;
  completed: boolean;
  newlyDone: string[];
  ok: boolean;
  detail?: string;
}

export interface SeedReport {
  seed: number;
  baseline: PhaseResult;
  wrongs: PhaseResult[];
  reference: PhaseResult;
  bonusDone: string[];
  ok: boolean;
}

export interface LevelTestReport {
  levelId: string;
  seeds: SeedReport[];
  ok: boolean;
}

export interface RunLevelTestsOptions {
  provider: SandboxProvider;
  level: Level;
  levelDir: string;
  seeds: number[];
}

const QUIET_MS = 1000;
const PHASE_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function specFor(level: Level, attemptId: string): SandboxSpec {
  if (level.sandbox.network !== 'none') {
    throw new Error(
      `level ${level.id} needs network '${level.sandbox.network}' (unsupported until T10.2)`,
    );
  }
  return {
    attemptId,
    userId: 'levels-test',
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
  };
}

async function setupSandbox(
  provider: SandboxProvider,
  level: Level,
  levelDir: string,
  seed: number,
  tag: string,
): Promise<SandboxHandle> {
  const handle = await provider.create(specFor(level, `levels-test-${level.id}-s${seed}-${tag}`));
  try {
    await runSetup(provider, handle, compileSetup(level, levelDir, seed), seed);
    return handle;
  } catch (err) {
    await provider.destroy(handle);
    throw err;
  }
}

/** Feed script text into the interactive shell as if typed, tracking answers and commands. */
async function driveScript(
  provider: SandboxProvider,
  handle: SandboxHandle,
  tracker: TrackerState,
  scriptText: string,
): Promise<void> {
  const shell = await provider.openShell(handle, { cols: 80, rows: 24 });
  const inbox = await provider.watchFile(handle, '/run/tq/inbox', (line) => {
    touch();
    handleInboxLine(tracker, line);
  });
  const cmdlog = await provider.watchFile(handle, '/run/tq/cmdlog', (line) => {
    touch();
    const entry = parseCmdlogLine(line);
    if (entry !== undefined) {
      noteCommand(tracker, entry);
    }
  });
  let active = Date.now();
  function touch(): void {
    active = Date.now();
  }
  shell.onData(touch);
  try {
    shell.write(scriptText.endsWith('\n') ? scriptText : `${scriptText}\n`);
    const deadline = Date.now() + PHASE_TIMEOUT_MS;
    while (Date.now() - active < QUIET_MS && Date.now() < deadline) {
      await sleep(100);
    }
  } finally {
    shell.close();
    inbox.stop();
    cmdlog.stop();
  }
}

function readSolution(levelDir: string, ref: string): string {
  return readFileSync(join(levelDir, ref), 'utf8');
}

async function runSeed(
  provider: SandboxProvider,
  level: Level,
  levelDir: string,
  seed: number,
): Promise<SeedReport> {
  // Baseline + reference share one pristine sandbox (baseline runs nothing).
  const main = await setupSandbox(provider, level, levelDir, seed, 'main');
  try {
    const tracker = createTracker(level);
    const baselineEval = await evaluate(provider, main, level, tracker, { seed });
    const baseline: PhaseResult = {
      phase: 'baseline',
      label: 'no actions',
      completed: baselineEval.completed,
      newlyDone: baselineEval.newlyDone,
      ok: !baselineEval.completed,
      detail: baselineEval.completed
        ? 'vacuous: required objectives pass with no actions'
        : undefined,
    };

    await driveScript(provider, main, tracker, readSolution(levelDir, level.solutions.reference));
    const refEval = await evaluate(provider, main, level, tracker, { seed });
    const bonusDone = level.objectives
      .filter((o) => o.bonus && (tracker.done.get(o.id) ?? false))
      .map((o) => o.id);
    const reference: PhaseResult = {
      phase: 'reference',
      label: level.solutions.reference,
      completed: refEval.completed,
      newlyDone: refEval.newlyDone,
      ok: refEval.completed,
      detail: refEval.completed ? undefined : 'reference solution did not complete the level',
    };

    const wrongs: PhaseResult[] = [];
    for (const wrong of level.solutions.wrong) {
      const handle = await setupSandbox(provider, level, levelDir, seed, `wrong-${wrongs.length}`);
      try {
        const wrongTracker = createTracker(level);
        await driveScript(provider, handle, wrongTracker, readSolution(levelDir, wrong));
        const wrongEval = await evaluate(provider, handle, level, wrongTracker, { seed });
        wrongs.push({
          phase: 'wrong',
          label: wrong,
          completed: wrongEval.completed,
          newlyDone: wrongEval.newlyDone,
          ok: !wrongEval.completed,
          detail: wrongEval.completed ? 'wrong solution completed the level' : undefined,
        });
      } finally {
        await provider.destroy(handle);
      }
    }

    const ok = baseline.ok && reference.ok && wrongs.every((w) => w.ok);
    return { seed, baseline, wrongs, reference, bonusDone, ok };
  } finally {
    await provider.destroy(main);
  }
}

export async function runLevelTests(opts: RunLevelTestsOptions): Promise<LevelTestReport> {
  const seeds: SeedReport[] = [];
  for (const seed of opts.seeds) {
    seeds.push(await runSeed(opts.provider, opts.level, opts.levelDir, seed));
  }
  return { levelId: opts.level.id, seeds, ok: seeds.every((s) => s.ok) };
}

export function formatReport(report: LevelTestReport): string[] {
  const lines: string[] = [];
  for (const seed of report.seeds) {
    const flag = (ok: boolean): string => (ok ? 'ok' : 'FAIL');
    lines.push(
      `${report.levelId} seed=${seed.seed} baseline: ${seed.baseline.completed ? 'complete' : 'incomplete'} (${flag(seed.baseline.ok)})`,
    );
    for (const wrong of seed.wrongs) {
      lines.push(
        `${report.levelId} seed=${seed.seed} wrong ${wrong.label}: ${wrong.completed ? 'complete' : 'incomplete'} (${flag(wrong.ok)})`,
      );
    }
    const bonus = seed.bonusDone.length > 0 ? `, bonus: ${seed.bonusDone.join(',')}` : '';
    lines.push(
      `${report.levelId} seed=${seed.seed} reference: ${seed.reference.completed ? 'complete' : 'incomplete'} (${flag(seed.reference.ok)}${bonus})`,
    );
  }
  return lines;
}

export async function runMatrix(
  provider: DockerProvider,
  levels: { level: Level; levelDir: string }[],
  seeds: number[],
): Promise<{ reports: LevelTestReport[]; ok: boolean }> {
  const reports: LevelTestReport[] = [];
  for (const { level, levelDir } of levels) {
    reports.push(await runLevelTests({ provider, level, levelDir, seeds }));
  }
  return { reports, ok: reports.every((r) => r.ok) };
}
