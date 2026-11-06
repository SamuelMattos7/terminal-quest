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
    explain: [{ command: 'pwd', parts: [{ token: 'pwd', meaning: 'Print directory' }] }],
    cheatsheet: [{ skill: 'pwd', syntax: 'pwd', note: 'Print directory' }],
    solutions: { reference: 'solution.sh', wrong: ['wrong/attempt.sh'] },
    ...overrides,
  });
}

/** Temp level dir at `<tmp>/w1/01-sample` with the given files; caller cleans up. */
function makeDir(files: string[] = ['solution.sh', 'wrong/attempt.sh']): {
  dir: string;
  cleanup: () => void;
} {
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

  it('requires explain cards, cheatsheet entries and a wrong solution on lessons', () => {
    const { dir, cleanup } = makeDir();
    try {
      const level = makeLevel({
        explain: [],
        cheatsheet: [],
        solutions: { reference: 'solution.sh', wrong: [] },
      });
      expect(lintLevels(loaded([{ level, dir }]))[0]?.issues).toEqual([
        'at least one explain card is required',
        'at least one cheatsheet entry is required',
        'need at least 1 distinct wrong solution script(s)',
      ]);
    } finally {
      cleanup();
    }
  });

  it('requires two distinct wrong scripts on bosses', () => {
    const { dir, cleanup } = makeDir(['solution.sh', 'wrong/attempt.sh', 'wrong/other.sh']);
    try {
      const level = makeLevel({
        kind: 'boss',
        solutions: { reference: 'solution.sh', wrong: ['wrong/attempt.sh', './wrong/attempt.sh'] },
      });
      expect(lintLevels(loaded([{ level, dir }]))[0]?.issues).toContain(
        'need at least 2 distinct wrong solution script(s)',
      );
      level.solutions.wrong[1] = 'wrong/other.sh';
      expect(lintLevels(loaded([{ level, dir }]))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it.each(['inline', 'referenced'])('checks %s seeded setup text for answers', (source) => {
    const { dir, cleanup } = makeDir([
      'solution.sh',
      'wrong/attempt.sh',
      'setup/gen.sh',
      'setup/note.txt',
    ]);
    try {
      const file = {
        path: '/home/player/note.txt',
        ...(source === 'inline'
          ? { content: 'Read the clues.' }
          : { content_file: 'setup/note.txt' }),
      };
      const level = makeLevel({
        setup: { files: [file], generators: [{ script: 'setup/gen.sh' }] },
        objectives: [
          {
            id: 'answer',
            text: 'Submit the answer.',
            check: {
              type: 'all',
              checks: [{ type: 'answer_equals', value: 'secret-answer', case_sensitive: false }],
            },
          },
        ],
      });
      expect(lintLevels(loaded([{ level, dir }]))).toEqual([]);
      const text = 'Answer: SECRET-ANSWER';
      if (source === 'inline') {
        level.setup!.files[0]!.content = text;
      } else {
        writeFileSync(join(dir, 'setup/note.txt'), text);
      }
      const issues = lintLevels(loaded([{ level, dir }]))[0]?.issues;
      expect(issues?.join(' ')).toContain('contains a check answer');
      expect(issues?.join(' ')).not.toContain(text);
    } finally {
      cleanup();
    }
  });

  it('flags a seeded answer read directly from a static setup file', () => {
    const { dir, cleanup } = makeDir([
      'solution.sh',
      'wrong/attempt.sh',
      'setup/gen.sh',
      'setup/key',
    ]);
    try {
      const level = makeLevel({
        setup: {
          files: [{ path: '/home/player/key', content_file: 'setup/key' }],
          generators: [{ script: 'setup/gen.sh' }],
        },
        objectives: [
          {
            id: 'answer',
            text: 'Submit the answer.',
            check: { type: 'answer_equals', from_file: '/home/player/key' },
          },
        ],
      });
      expect(lintLevels(loaded([{ level, dir }]))[0]?.issues.join(' ')).toContain(
        'contains a check answer',
      );
    } finally {
      cleanup();
    }
  });
});
