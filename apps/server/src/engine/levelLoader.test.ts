import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { LevelLoadError, loadLevels } from './levelLoader.js';

let dir = '';

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
    dir = '';
  }
});

function makeTree(opts?: {
  skills?: unknown;
  levels?: { dir: string; level: Record<string, unknown> }[];
  rawLevelYaml?: { dir: string; text: string };
}): string {
  dir = mkdtempSync(join(tmpdir(), 'tq-loader-test-'));
  writeFileSync(
    join(dir, 'skills.yaml'),
    stringifyYaml(
      opts?.skills ?? [
        { id: 'pwd', title: 'pwd', group: 'navigation', world: 1 },
        { id: 'ls', title: 'ls', group: 'navigation', world: 1 },
      ],
    ),
  );
  const content = join(dir, 'content');
  for (const entry of opts?.levels ?? [defaultLevel('first', 1), defaultLevel('second', 2)]) {
    const levelDir = join(content, entry.dir);
    mkdirSync(levelDir, { recursive: true });
    writeFileSync(join(levelDir, 'level.yaml'), stringifyYaml(entry.level));
  }
  if (opts?.rawLevelYaml !== undefined) {
    const levelDir = join(content, opts.rawLevelYaml.dir);
    mkdirSync(levelDir, { recursive: true });
    writeFileSync(join(levelDir, 'level.yaml'), opts.rawLevelYaml.text);
  }
  return join(content);
}

function defaultLevel(
  suffix: string,
  order: number,
): { dir: string; level: Record<string, unknown> } {
  const nn = String(order).padStart(2, '0');
  return {
    dir: `w1/${nn}-${suffix}`,
    level: {
      id: `w1-${nn}-${suffix}`,
      world: 1,
      order,
      title: `Level ${suffix}`,
      kind: 'lesson',
      difficulty: 1,
      estimated_minutes: 3,
      story: 'A short story.',
      teaches: ['pwd'],
      par_commands: 2,
      xp: 50,
      objectives: [
        {
          id: 'did-it',
          text: 'Do it.',
          check: { type: 'file_exists', path: '/home/player/a.txt' },
        },
      ],
      hints: ['one', 'two', 'three'],
      success_message: 'Done.',
      solutions: { reference: 'solution.sh' },
    },
  };
}

describe('loadLevels', () => {
  it('loads a valid tree and builds indexes', () => {
    const loaded = loadLevels(makeTree());
    expect(loaded.levels).toHaveLength(2);
    expect(loaded.byId.get('w1-01-first')?.order).toBe(1);
    expect(loaded.byWorld.get(1)?.map((l) => l.id)).toEqual(['w1-01-first', 'w1-02-second']);
    expect(loaded.skills.get('pwd')?.title).toBe('pwd');
    expect(loaded.levelDirs.get('w1-02-second') ?? '').toContain('02-second');
  });

  it('fails with the file name on invalid YAML', () => {
    const root = makeTree({
      levels: [],
      rawLevelYaml: { dir: 'w1/01-bad', text: 'id: [unclosed\n' },
    });
    const err = (() => {
      try {
        loadLevels(root);
      } catch (e) {
        return e as LevelLoadError;
      }
      throw new Error('should have thrown');
    })();
    expect(err).toBeInstanceOf(LevelLoadError);
    expect(err.entries[0]?.file).toContain('01-bad');
  });

  it('fails with clear schema messages on an invalid level', () => {
    const bad = defaultLevel('bad', 1);
    delete (bad.level as Record<string, unknown>)['hints'];
    const root = makeTree({ levels: [bad] });
    try {
      loadLevels(root);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LevelLoadError);
      expect((err as LevelLoadError).message).toContain('01-bad');
      expect((err as LevelLoadError).message).toContain('hints');
    }
  });

  it('rejects duplicate level ids across directories', () => {
    const a = defaultLevel('a', 1);
    const b = defaultLevel('b', 2);
    (b.level as Record<string, unknown>)['id'] = (a.level as Record<string, unknown>)['id'];
    try {
      loadLevels(makeTree({ levels: [a, b] }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as LevelLoadError).message).toContain('duplicate level id');
    }
  });
});
