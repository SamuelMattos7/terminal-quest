import { dirname, join, resolve } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadLevels } from '@terminal-quest/server/engine/levelLoader';
import { DockerProvider } from '@terminal-quest/server/sandbox/dockerProvider';
import { formatReport, runLevelTests } from './testLevels.js';

function contentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..'), 'packages', 'levels', 'content');
}

describe('runLevelTests on the w1-02 sample', () => {
  it('reports baseline-fail, wrong-fail, reference-pass', async () => {
    const loaded = loadLevels(contentRoot());
    const level = loaded.byId.get('w1-02-where-am-i');
    const levelDir = loaded.levelDirs.get('w1-02-where-am-i');
    expect(level).toBeDefined();
    expect(levelDir).toBeDefined();
    if (level === undefined || levelDir === undefined) {
      throw new Error('unreachable');
    }
    const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
    const scratch = mkdtempSync(join(tmpdir(), 'tq-slow-solution-'));
    const report = await (async () => {
      try {
        cpSync(levelDir, scratch, { recursive: true });
        const solution = join(scratch, level.solutions.reference);
        const body = readFileSync(solution, 'utf8');
        writeFileSync(solution, 'sleep 1.5\n' + body);
        return await runLevelTests({ provider, level, levelDir: scratch, seeds: [1] });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    })();
    expect(report.ok).toBe(true);
    const [seed] = report.seeds;
    expect(seed?.baseline.completed).toBe(false);
    expect(seed?.wrongs).toHaveLength(1);
    expect(seed?.wrongs[0]?.completed).toBe(false);
    expect(seed?.reference.completed).toBe(true);
    expect(formatReport(report).join('\n')).toContain('reference: complete (ok)');
  }, 180_000);
});
