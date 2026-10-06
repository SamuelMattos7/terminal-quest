import { statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Check, Level } from '@terminal-quest/shared';
import type { LoadedLevels } from '@terminal-quest/server/engine/levelLoader';

// Content rules for plan.md §12.3 that go beyond the zod schema (which the
// loader already enforces: 3 hints, story ≤ 80 words, title ≤ 40 chars).

export interface LintEntry {
  levelId: string;
  issues: string[];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function collectExecScripts(check: Check, out: string[]): void {
  if (check.type === 'exec') {
    if (check.script !== undefined) {
      out.push(check.script);
    }
    return;
  }
  if (check.type === 'all' || check.type === 'any' || check.type === 'not') {
    for (const sub of check.checks) {
      collectExecScripts(sub, out);
    }
  }
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

  const refs: string[] = [...level.solutions.wrong];
  if (level.solutions.reference !== undefined) {
    refs.push(level.solutions.reference);
  }
  for (const file of level.setup?.files ?? []) {
    if (file.content_file !== undefined) {
      refs.push(file.content_file);
    }
  }
  for (const gen of level.setup?.generators ?? []) {
    refs.push(gen.script);
  }
  for (const objective of level.objectives) {
    collectExecScripts(objective.check, refs);
  }
  for (const ref of refs) {
    if (!isFile(join(dir, ref))) {
      issues.push(`referenced file does not exist: ${ref}`);
    }
  }

  if (level.kind === 'boss' && level.solutions.wrong.length < 1) {
    issues.push('boss levels need at least one wrong solution');
  }

  // AGENTS.md hard rule 7: seeded answers must come from /opt/tq/secret,
  // never from plaintext in setup.files.
  if (
    (level.setup?.generators.length ?? 0) > 0 &&
    (level.setup?.files.some((f) => f.content !== undefined) ?? false)
  ) {
    issues.push(
      'levels with generators must not use inline setup.files content (use content_file)',
    );
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
