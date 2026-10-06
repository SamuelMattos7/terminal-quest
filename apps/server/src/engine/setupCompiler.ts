import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { Level } from '@terminal-quest/shared';
import type { PutFilesEntry } from '../sandbox/provider.js';

// Setup compiler for plan.md §12.2: turns a level's `setup` into tar
// entries for putFiles plus one root-run `bash -e` script. Pure function —
// no Docker, fully unit-testable. Execution lives in setupRunner.ts.

export class SetupCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupCompileError';
  }
}

export interface CompiledSetup {
  files: PutFilesEntry[];
  script: string;
}

/** Single-quote a string for safe embedding in the root-run script. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function readLevelFile(levelDir: string, ref: string): Buffer {
  if (!ref || ref.startsWith('/') || ref.split(/[\\/]/).includes('..')) {
    throw new SetupCompileError(`setup reference must be a level-relative path: ${ref}`);
  }
  const full = resolve(levelDir, ref);
  const root = resolve(levelDir) + sep;
  if (!full.startsWith(root)) {
    throw new SetupCompileError(`setup reference escapes the level dir: ${ref}`);
  }
  try {
    return readFileSync(full);
  } catch (err) {
    throw new SetupCompileError(`setup file not found: ${ref} (${(err as Error).message})`);
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => {
        try {
          return statSync(join(dir, name)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function mustBeAbsolute(path: string, what: string): void {
  if (!path.startsWith('/')) {
    throw new SetupCompileError(`${what} path must be absolute: ${path}`);
  }
}

export function compileSetup(level: Level, levelDir: string, seed: number): CompiledSetup {
  const files: PutFilesEntry[] = [];
  const lines: string[] = [];
  const setup = level.setup;

  for (const dir of setup?.dirs ?? []) {
    mustBeAbsolute(dir.path, 'setup.dirs');
    lines.push(`mkdir -p ${shQuote(dir.path)}`);
  }
  for (const dir of setup?.dirs ?? []) {
    lines.push(`chown ${shQuote(dir.owner)} ${shQuote(dir.path)}`);
    lines.push(`chmod ${shQuote(dir.mode)} ${shQuote(dir.path)}`);
  }

  for (const file of setup?.files ?? []) {
    mustBeAbsolute(file.path, 'setup.files');
    const content =
      file.content !== undefined
        ? Buffer.from(file.content, 'utf8')
        : readLevelFile(levelDir, file.content_file ?? '');
    files.push({ path: file.path, content, mode: parseInt(file.mode ?? '644', 8) });
    lines.push(`chown ${shQuote(file.owner)} ${shQuote(file.path)}`);
    if (file.mode !== undefined) {
      lines.push(`chmod ${shQuote(file.mode)} ${shQuote(file.path)}`);
    }
  }

  lines.push(`export TQ_SEED=${seed}`);
  for (const gen of setup?.generators ?? []) {
    const content = readLevelFile(levelDir, gen.script);
    const dest = `/opt/tq/gen/${basename(gen.script)}`;
    files.push({ path: dest, content, mode: 0o755 });
    lines.push(`bash ${shQuote(dest)}`);
  }

  for (const cmd of setup?.commands ?? []) {
    lines.push(cmd);
  }

  if (setup?.rc_extra !== undefined) {
    lines.push(`printf '%s\\n' ${shQuote(setup.rc_extra)} >> /home/player/.bashrc`);
    lines.push(`chown player:player /home/player/.bashrc`);
  }

  lines.push(`mkdir -p /opt/tq/secret`);
  lines.push(`chmod 700 /opt/tq/secret`);
  lines.push(`mkdir -p /run/tq`);
  lines.push(`install -o root -g root -m 0622 /dev/null /run/tq/cmdlog`);
  lines.push(`install -o root -g root -m 0622 /dev/null /run/tq/inbox`);

  for (const name of listFiles(join(levelDir, 'checks'))) {
    const content = readLevelFile(levelDir, `checks/${name}`);
    files.push({ path: `/opt/tq/checks/${level.id}/${name}`, content, mode: 0o755 });
  }

  return { files, script: lines.join('\n') + '\n' };
}
