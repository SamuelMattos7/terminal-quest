import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LevelSchema, type Level } from '@terminal-quest/shared';
import { compileSetup, SetupCompileError, shQuote } from './setupCompiler.js';

function makeLevel(overrides: Record<string, unknown> = {}): Level {
  return LevelSchema.parse({
    id: 'w1-02-where-am-i',
    world: 1,
    order: 2,
    title: 'Where Am I?',
    kind: 'lesson',
    difficulty: 1,
    estimated_minutes: 4,
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

describe('shQuote', () => {
  it('single-quotes hostile paths', () => {
    expect(shQuote(`a'b`)).toBe(`'a'\\''b'`);
    expect(shQuote('/home/player/my dir')).toBe("'/home/player/my dir'");
  });
});

describe('compileSetup', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') {
      rmSync(dir, { recursive: true, force: true });
      dir = '';
    }
  });

  function makeDir(files: Record<string, string>): string {
    dir = mkdtempSync(join(tmpdir(), 'tq-setup-test-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  it('uploads inline files, content files, generators, and checks', () => {
    const levelDir = makeDir({
      'setup/readme.txt': 'hello\n',
      'setup/gen.sh': '#!/bin/bash\necho gen\n',
      'checks/verify.sh': '#!/bin/bash\ntest -f /a\n',
    });
    const level = makeLevel({
      setup: {
        dirs: [{ path: '/home/player/config', owner: 'player', mode: '755' }],
        files: [
          { path: '/home/player/a.txt', content: 'inline\n' },
          { path: '/home/player/readme.txt', content_file: 'setup/readme.txt' },
        ],
        generators: [{ script: 'setup/gen.sh' }],
      },
    });
    const compiled = compileSetup(level, levelDir, 42);
    const byPath = new Map(compiled.files.map((f) => [f.path, f]));
    expect(byPath.get('/home/player/a.txt')?.content.toString()).toBe('inline\n');
    expect(byPath.get('/home/player/a.txt')?.mode).toBe(0o644);
    expect(byPath.get('/home/player/readme.txt')?.content.toString()).toBe('hello\n');
    expect(byPath.get('/opt/tq/gen/gen.sh')?.mode).toBe(0o755);
    expect(byPath.get('/opt/tq/checks/w1-02-where-am-i/verify.sh')?.mode).toBe(0o755);
  });

  it('orders the root script: dirs, perms, seed, generators, commands, rc, run-files', () => {
    const levelDir = makeDir({ 'setup/gen.sh': 'echo gen\n' });
    const level = makeLevel({
      setup: {
        dirs: [{ path: '/home/player/config', owner: 'player', mode: '755' }],
        generators: [{ script: 'setup/gen.sh' }],
        commands: ['chown -R player:player /home/player'],
        rc_extra: `alias ls='ls --color=auto'`,
      },
    });
    const script = compileSetup(level, levelDir, 7).script;
    const pos = (needle: string): number => {
      const i = script.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const mkdir = pos('mkdir -p');
    const seed = pos('export TQ_SEED=7');
    const gen = pos(`bash '/opt/tq/gen/gen.sh'`);
    const cmd = pos('chown -R player:player');
    const rc = pos('.bashrc');
    const secret = pos('/opt/tq/secret');
    const cmdlog = pos('/run/tq/cmdlog');
    expect(mkdir).toBeLessThan(seed);
    expect(seed).toBeLessThan(gen);
    expect(gen).toBeLessThan(cmd);
    expect(cmd).toBeLessThan(rc);
    expect(rc).toBeLessThan(secret);
    expect(secret).toBeLessThan(cmdlog);
    expect(script).toContain(`'alias ls='\\''ls --color=auto'\\'''`);
  });

  it('throws a clear error for a missing content file', () => {
    const levelDir = makeDir({});
    const level = makeLevel({
      setup: { files: [{ path: '/home/player/a.txt', content_file: 'setup/nope.txt' }] },
    });
    try {
      compileSetup(level, levelDir, 1);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SetupCompileError);
      expect((err as Error).message).toContain('setup/nope.txt');
    }
  });

  it('rejects escaping generator paths; schema rejects relative file paths', () => {
    const levelDir = makeDir({});
    const escaping = makeLevel({
      setup: { generators: [{ script: '../evil.sh' }] },
    });
    expect(() => compileSetup(escaping, levelDir, 1)).toThrow(SetupCompileError);
    // The schema is the first line of defense for setup file/dir paths;
    // the compiler re-checks them as belt and suspenders.
    expect(() =>
      LevelSchema.parse({
        ...(makeLevel() as unknown as Record<string, unknown>),
        setup: { files: [{ path: 'home/player/a.txt', content: 'x' }] },
      }),
    ).toThrow();
  });
});
