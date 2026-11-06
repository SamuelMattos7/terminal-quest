import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LevelLoadError, loadLevels } from '@terminal-quest/server/engine/levelLoader';
import { DockerProvider } from '@terminal-quest/server/sandbox/dockerProvider';
import { lintLevels } from './lint.js';
import { formatReport, runMatrix } from './testLevels.js';

// CLI behind `pnpm levels:lint` (and `levels:test` in T2.6).

function contentRoot(): string {
  // src/main.ts and dist/main.js both sit two levels below the repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..'), 'packages', 'levels', 'content');
}

function runLint(): void {
  let loaded;
  try {
    loaded = loadLevels(contentRoot());
  } catch (err) {
    if (err instanceof LevelLoadError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const entries = lintLevels(loaded);
  if (entries.length === 0) {
    console.log(`levels:lint — ${loaded.levels.length} level(s), 0 problems`);
    return;
  }
  for (const entry of entries) {
    console.error(`${entry.levelId}:`);
    for (const issue of entry.issues) {
      console.error(`  - ${issue}`);
    }
  }
  console.error(`${entries.length} level(s) with problems`);
  process.exitCode = 1;
}

const command = process.argv[2];
if (command === 'lint' || command === undefined) {
  runLint();
} else if (command === 'test') {
  await runTest();
} else {
  console.error(
    'usage: level-runner [lint|test] [--level <id>] [--world <n,...>] [--seeds <count>] [--expect-levels <count>]',
  );
  process.exitCode = 2;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag, 3);
  return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
}

async function runTest(): Promise<void> {
  const levelId = argValue('--level');
  const worldsRaw = argValue('--world');
  const seedsRaw = argValue('--seeds') ?? '3';
  const worlds =
    worldsRaw === undefined ? undefined : worldsRaw.split(',').map((w) => Number(w.trim()));
  const seedCount = Number(seedsRaw);
  const expectedRaw = argValue('--expect-levels');
  const expectedCount = expectedRaw === undefined ? undefined : Number(expectedRaw);
  if (
    (worlds !== undefined &&
      (worlds.length === 0 || worlds.some((w) => !Number.isInteger(w) || w < 1))) ||
    !Number.isInteger(seedCount) ||
    seedCount < 1 ||
    (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 1))
  ) {
    console.error(
      'levels:test: --world must be a comma list of positive integers; --seeds and --expect-levels must be positive integers',
    );
    process.exitCode = 2;
    return;
  }
  const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

  let loaded;
  try {
    loaded = loadLevels(contentRoot());
  } catch (err) {
    if (err instanceof LevelLoadError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const missingWorlds = [...new Set(worlds)].filter((world) => !loaded.byWorld.has(world));
  if (missingWorlds.length > 0) {
    console.error(
      `levels:test: no levels found for requested world(s): ${missingWorlds.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const selected = loaded.levels
    .filter(
      (l) =>
        (levelId === undefined || l.id === levelId) &&
        (worlds === undefined || worlds.includes(l.world)),
    )
    .map((level) => ({ level, levelDir: loaded.levelDirs.get(level.id) ?? '' }))
    .filter((s) => s.levelDir !== '');
  if (levelId !== undefined && selected.length === 0) {
    console.error(`levels:test: unknown level '${levelId}'`);
    process.exitCode = 1;
    return;
  }
  if (selected.length === 0) {
    console.error('levels:test: no levels selected');
    process.exitCode = 1;
    return;
  }
  if (expectedCount !== undefined && selected.length !== expectedCount) {
    console.error(`levels:test: expected ${expectedCount} level(s), selected ${selected.length}`);
    process.exitCode = 1;
    return;
  }

  const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
  const { reports, ok } = await runMatrix(provider, selected, seeds);
  let failures = 0;
  for (const report of reports) {
    for (const line of formatReport(report)) {
      console.log(line);
    }
    if (!report.ok) {
      failures += 1;
    }
  }
  console.log(
    `levels:test — ${reports.length} level(s), ${seeds.length} seed(s), ${failures} failure(s)`,
  );
  process.exitCode = ok ? 0 : 1;
}
