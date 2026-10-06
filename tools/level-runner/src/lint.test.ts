import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import type { LoadedLevels } from '@terminal-quest/server/engine/levelLoader';
import { lintLevels } from './lint.js';

function makeLevel(overrides: Record<string, unknown> = {}): Level {
  return LevelSchema.parse({
    id: 'w1-01-sample',
    world: 1,
    order: 1,
    title: 'Sample',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 3,
    story: 'A short story.',
    teaches: ['pwd'],
    par_commands: 2,
    xp: 50,
    objectives: [
      { id: 'did-it', text: 'Do it.', check: { type: 'file_exists', path: '/home/player/a.txt' } },
    ],
    hints: ['one', 'two', 'three'],
    success_message: 'Done.',
    solutions: { reference: 'solution.sh' },
    ...overrides,
  });
}

/** Temp level dir at `<tmp>/w1/01-sample` with the given files; caller cleans up. */
function makeDir(files: string[] = ['solution.sh']): { dir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'tq-lint-test-'));
  const dir = join(root, 'w1', '01-sample');
  for (const f of files) {
    const full = join(dir, f);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# fixture\n');
  }
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function loaded(levels: { level: Level; dir: string }[], skills = ['pwd', 'ls']): LoadedLevels {
  return {
    levels: levels.map((l) => l.level),
    byId: new Map(levels.map((l) => [l.level.id, l.level])),
    byWorld: new Map([[1, levels.map((l) => l.level)]]),
    skills: new Map(skills.map((id) => [id, { id, title: id, group: 'g', world: 1, prereqs: [] }])),
    levelDirs: new Map(levels.map((l) => [l.level.id, l.dir])),
  };
}

describe('lintLevels', () => {
  it('passes a clean level', () => {
    const { dir, cleanup } = makeDir();
    try {
      expect(lintLevels(loaded([{ level: makeLevel(), dir }]))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('flags an id that does not match its directory', () => {
    const { dir, cleanup } = makeDir();
    try {
      const entries = lintLevels(loaded([{ level: makeLevel({ id: 'w1-02-other' }), dir }]));
      expect(entries).toHaveLength(1);
      expect(entries[0]?.issues.join(' ')).toContain('does not match directory');
    } finally {
      cleanup();
    }
  });

  it('flags a gap in world ordering', () => {
    const { dir, cleanup } = makeDir();
    try {
      const a = makeLevel({ id: 'w1-01-a', order: 1 });
      const b = makeLevel({ id: 'w1-03-b', order: 3 });
      const entries = lintLevels(
        loaded([
          { level: a, dir },
          { level: b, dir },
        ]),
      );
      expect(entries.some((e) => e.issues.join(' ').includes('gap-free'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('flags too many non-bonus objectives and unknown skills', () => {
    const { dir, cleanup } = makeDir();
    try {
      const objectives = Array.from({ length: 5 }, (_, i) => ({
        id: `o${i}`,
        text: 'Do it.',
        check: { type: 'file_exists', path: '/x' },
      }));
      const level = makeLevel({ objectives, teaches: ['nope'] });
      const issues = lintLevels(loaded([{ level, dir }]))[0]?.issues.join(' ') ?? '';
      expect(issues).toContain('non-bonus objectives');
      expect(issues).toContain("unknown teaches skill 'nope'");
    } finally {
      cleanup();
    }
  });

  it('flags missing referenced files and boss levels without wrong solutions', () => {
    const { dir, cleanup } = makeDir([]);
    try {
      const level = makeLevel({
        kind: 'boss',
        objectives: [
          {
            id: 'did-it',
            text: 'Do it.',
            check: { type: 'exec', script: 'checks/verify.sh' },
          },
        ],
      });
      const issues = lintLevels(loaded([{ level, dir }]))[0]?.issues.join(' ') ?? '';
      expect(issues).toContain('solution.sh');
      expect(issues).toContain('checks/verify.sh');
      expect(issues).toContain('wrong solution');
    } finally {
      cleanup();
    }
  });

  it('flags inline setup content when generators exist', () => {
    const { dir, cleanup } = makeDir();
    try {
      const level = makeLevel({
        setup: {
          files: [{ path: '/home/player/a.txt', content: 'secret-answer' }],
          generators: [{ script: 'setup/gen.sh' }],
        },
      });
      const issues = lintLevels(loaded([{ level, dir }]))[0]?.issues.join(' ') ?? '';
      expect(issues).toContain('inline setup.files content');
    } finally {
      cleanup();
    }
  });
});
