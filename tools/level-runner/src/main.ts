import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LevelLoadError, loadLevels } from '@terminal-quest/server/engine/levelLoader';
import { lintLevels } from './lint.js';

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
  console.error('levels:test is not yet implemented (T2.6)');
  process.exitCode = 1;
} else {
  console.error(`usage: level-runner [lint|test]`);
  process.exitCode = 2;
}
