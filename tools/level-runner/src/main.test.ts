import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function runLevels(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts', 'test', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 4_000,
  });
}

describe('levels:test selection', () => {
  it.each(['999', '1,999'])('rejects a missing world in --world %s', (worlds) => {
    const result = runLevels('--world', worlds);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no levels found for requested world(s): 999');
  });

  it('rejects a missing --world value', () => {
    const result = runLevels('--world');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--world must be a comma list');
  });

  it('rejects a partial release before starting Docker', () => {
    const result = runLevels('--level', 'w1-01-first-words', '--expect-levels', '2');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('expected 2 level(s), selected 1');
  });
});
