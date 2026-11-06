import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Check, Level } from '@terminal-quest/shared';
import type { LoadedLevels } from '@terminal-quest/server/engine/levelLoader';

// Content rules for plan.md §12.3 that go beyond the zod schema (which the
// loader already enforces: 3 hints, story ≤ 80 words, title ≤ 40 chars).

export interface LintEntry {
  levelId: string;
  issues: string[];
}

function* leaves(check: Check): Generator<Check> {
  if (check.type === 'all' || check.type === 'any' || check.type === 'not') {
    for (const sub of check.checks) {
      yield* leaves(sub);
    }
  } else {
    yield check;
  }
}

function resolveRef(dir: string, ref: string): string {
  if (/^(?:[\\/]|[a-z]:)/i.test(ref) || ref.split(/[\\/]/).includes('..')) {
    throw new Error(`reference must stay inside the level directory: ${ref}`);
  }
  let path: string;
  try {
    path = realpathSync(resolve(dir, ref));
    if (!statSync(path).isFile()) {
      throw new Error('not a regular file');
    }
  } catch {
    throw new Error(`referenced file does not exist: ${ref}`);
  }
  const rel = relative(realpathSync(dir), path);
  if (isAbsolute(rel) || rel.startsWith(`..${sep}`)) {
    throw new Error(`reference must stay inside the level directory: ${ref}`);
  }
  return path;
}

function containsAnswer(check: Check, path: string, text: string): boolean {
  if (check.type === 'answer_equals') {
    if (check.from_file !== undefined) {
      return posix.normalize(check.from_file) === path;
    }
    const normalize = (value: string) =>
      check.case_sensitive === false ? value.toLowerCase() : value;
    const answer = normalize(
      check.trim === false ? (check.value ?? '') : (check.value ?? '').trim(),
    );
    return answer !== '' && normalize(text).includes(answer);
  }
  if (check.type !== 'file_content') {
    return false;
  }
  const content = check.trim ? text.trim() : text;
  const literal = check.equals ?? check.contains;
  if (literal !== undefined && !literal.includes('{{secret:')) {
    const answer = check.equals !== undefined && check.trim ? literal.trim() : literal;
    return answer !== '' && content.includes(answer);
  }
  if (check.sha256 !== undefined) {
    return createHash('sha256').update(content).digest('hex') === check.sha256.toLowerCase();
  }
  // A broad regex can match unrelated setup text. Only apply it to its target file.
  if (posix.normalize(check.path) !== path) {
    return false;
  }
  if (check.matches !== undefined && !check.matches.includes('{{secret:')) {
    return new RegExp(check.matches).test(content);
  }
  return (
    check.lines_equal_unordered !== undefined &&
    JSON.stringify(content.split('\n').sort()) ===
      JSON.stringify([...check.lines_equal_unordered].sort())
  );
}

function lintOne(level: Level, dir: string, skills: Set<string>): string[] {
  const issues: string[] = [];

  const parts = dir.split(sep);
  const base = parts.at(-1) ?? '';
  const worldDir = parts.at(-2) ?? '';
  if (
    worldDir !== `w${level.world}` ||
    base !== level.id.replace(new RegExp(`^w${level.world}-`), '')
  ) {
    issues.push(`id '${level.id}' does not match directory '${worldDir}/${base}'`);
  }

  const nonBonus = level.objectives.filter((o) => !o.bonus).length;
  const limit = level.kind === 'boss' ? 8 : 4;
  if (nonBonus > limit) {
    issues.push(`too many non-bonus objectives (${nonBonus} > ${limit})`);
  }
  if (!level.objectives.some((o) => !o.optional)) {
    issues.push('at least one objective must be non-optional');
  }

  for (const skill of level.teaches) {
    if (!skills.has(skill)) {
      issues.push(`unknown teaches skill '${skill}' (missing from skills.yaml)`);
    }
  }

  if (level.explain.length === 0) {
    issues.push('at least one explain card is required');
  }
  if (level.cheatsheet.length === 0) {
    issues.push('at least one cheatsheet entry is required');
  }

  const checks = level.objectives.flatMap((objective) => [...leaves(objective.check)]);
  const refs = new Set([level.solutions.reference, ...level.solutions.wrong]);
  for (const file of level.setup?.files ?? []) {
    if (file.content_file !== undefined) {
      refs.add(file.content_file);
    }
  }
  for (const gen of level.setup?.generators ?? []) {
    refs.add(gen.script);
  }
  for (const check of checks) {
    if (check.type === 'exec' && check.script !== undefined) {
      refs.add(check.script);
    }
  }
  const paths = new Map<string, string>();
  for (const ref of refs) {
    try {
      paths.set(ref, resolveRef(dir, ref));
    } catch (err) {
      issues.push((err as Error).message);
    }
  }

  const wrong = new Set(level.solutions.wrong.map((ref) => paths.get(ref)));
  wrong.delete(undefined);
  wrong.delete(paths.get(level.solutions.reference));
  const minimum = level.kind === 'boss' ? 2 : 1;
  if (wrong.size < minimum) {
    issues.push(`need at least ${minimum} distinct wrong solution script(s)`);
  }

  if (level.setup !== undefined && level.setup.generators.length > 0) {
    for (const file of level.setup.files) {
      const source = paths.get(file.content_file ?? '');
      const path = posix.normalize(file.path);
      try {
        const text = file.content ?? (source === undefined ? '' : readFileSync(source, 'utf8'));
        if (
          path.startsWith('/opt/tq/secret/') ||
          checks.some((check) => containsAnswer(check, path, text))
        ) {
          issues.push(
            `seeded setup file '${file.path}' contains a check answer; generate answers under /opt/tq/secret`,
          );
        }
      } catch {
        issues.push(`cannot read setup content: ${file.content_file}`);
      }
    }
  }

  return issues;
}

export function lintLevels(loaded: LoadedLevels): LintEntry[] {
  const result: LintEntry[] = [];
  const skills = new Set(loaded.skills.keys());

  for (const [world, levels] of loaded.byWorld) {
    const orders = levels.map((l) => l.order).sort((a, b) => a - b);
    const contiguous =
      new Set(orders).size === orders.length &&
      orders[orders.length - 1]! - orders[0]! + 1 === orders.length;
    if (!contiguous) {
      result.push({
        levelId: `(world ${world} ordering)`,
        issues: [`orders must be unique and gap-free (got: ${orders.join(', ')})`],
      });
    }
  }

  for (const level of loaded.levels) {
    const dir = loaded.levelDirs.get(level.id);
    if (dir === undefined) {
      result.push({ levelId: level.id, issues: ['missing level directory'] });
      continue;
    }
    const issues = lintOne(level, dir, skills);
    if (issues.length > 0) {
      result.push({ levelId: level.id, issues });
    }
  }

  return result;
}
