import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { formatIssues, LevelSchema, type Level } from '@terminal-quest/shared';
import { SkillSchema, type Skill } from '@terminal-quest/shared';

// Level loader for plan.md §12.1: reads every level.yaml under the content
// root, validates with zod, and builds lookup indexes. All problems are
// collected and reported at once so authors fix everything in one pass.

export interface LevelLoadEntry {
  file: string;
  issues: string[];
}

export class LevelLoadError extends Error {
  constructor(readonly entries: LevelLoadEntry[]) {
    super(
      `failed to load levels:\n${entries
        .map((e) => `  ${e.file}:\n${e.issues.map((i) => `    - ${i}`).join('\n')}`)
        .join('\n')}`,
    );
    this.name = 'LevelLoadError';
  }
}

export interface LoadedLevels {
  levels: Level[];
  byId: Map<string, Level>;
  byWorld: Map<number, Level[]>;
  skills: Map<string, Skill>;
  /** Maps level id → its directory (for lint rules about referenced files). */
  levelDirs: Map<string, string>;
}

function readYamlFile(file: string, entries: LevelLoadEntry[]): unknown | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    entries.push({ file, issues: [`cannot read file: ${(err as Error).message}`] });
    return undefined;
  }
  try {
    return parseYaml(text);
  } catch (err) {
    entries.push({ file, issues: [`invalid YAML: ${(err as Error).message}`] });
    return undefined;
  }
}

function skillGraphIssues(skills: Map<string, Skill>): string[] {
  const issues: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(skill: Skill): void {
    if (visiting.has(skill.id)) {
      issues.push(`skill prerequisite cycle: ${[...visiting, skill.id].join(' -> ')}`);
      return;
    }
    if (visited.has(skill.id)) {
      return;
    }
    visiting.add(skill.id);
    const prereqs = new Set(skill.prereqs);
    if (prereqs.size !== skill.prereqs.length) {
      issues.push(`skill '${skill.id}' has duplicate prerequisites`);
    }
    for (const id of prereqs) {
      const prereq = skills.get(id);
      if (prereq === undefined) {
        issues.push(`skill '${skill.id}' has unknown prerequisite '${id}'`);
      } else {
        visit(prereq);
      }
    }
    visiting.delete(skill.id);
    visited.add(skill.id);
  }

  for (const skill of skills.values()) {
    visit(skill);
  }
  return issues;
}

export function loadLevels(contentRoot: string): LoadedLevels {
  const entries: LevelLoadEntry[] = [];
  const levels: Level[] = [];
  const levelDirs = new Map<string, string>();
  const seenIds = new Map<string, string>();

  const skillsFile = join(contentRoot, '..', 'skills.yaml');
  const skillsRaw = readYamlFile(skillsFile, entries);
  const skills = new Map<string, Skill>();
  if (skillsRaw !== undefined) {
    const parsed = z.array(SkillSchema).safeParse(skillsRaw);
    if (!parsed.success) {
      entries.push({ file: skillsFile, issues: formatIssues(parsed.error) });
    } else {
      const issues: string[] = [];
      for (const skill of parsed.data) {
        if (skills.has(skill.id)) {
          issues.push(`duplicate skill id '${skill.id}'`);
        } else {
          skills.set(skill.id, skill);
        }
      }
      issues.push(...skillGraphIssues(skills));
      if (issues.length > 0) {
        entries.push({ file: skillsFile, issues });
      }
    }
  }

  const contentDir = join(contentRoot);
  let worlds: string[] = [];
  try {
    worlds = readdirSync(contentDir).filter((d) => {
      try {
        return statSync(join(contentDir, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (err) {
    throw new LevelLoadError([
      { file: contentDir, issues: [`cannot read: ${(err as Error).message}`] },
    ]);
  }

  for (const world of worlds.sort()) {
    const worldDir = join(contentDir, world);
    const levelNames = readdirSync(worldDir).filter((d) => {
      try {
        return statSync(join(worldDir, d)).isDirectory();
      } catch {
        return false;
      }
    });
    for (const name of levelNames.sort()) {
      const file = join(worldDir, name, 'level.yaml');
      const raw = readYamlFile(file, entries);
      if (raw === undefined) {
        continue;
      }
      const parsed = LevelSchema.safeParse(raw);
      if (!parsed.success) {
        entries.push({ file, issues: formatIssues(parsed.error) });
        continue;
      }
      const firstSeen = seenIds.get(parsed.data.id);
      if (firstSeen !== undefined) {
        entries.push({
          file,
          issues: [`duplicate level id '${parsed.data.id}' (also in ${firstSeen})`],
        });
        continue;
      }
      seenIds.set(parsed.data.id, file);
      levels.push(parsed.data);
      levelDirs.set(parsed.data.id, join(worldDir, name));
    }
  }

  if (entries.length > 0) {
    throw new LevelLoadError(entries);
  }

  const byId = new Map(levels.map((l) => [l.id, l]));
  const byWorld = new Map<number, Level[]>();
  for (const level of levels) {
    const list = byWorld.get(level.world) ?? [];
    list.push(level);
    byWorld.set(level.world, list);
  }
  for (const list of byWorld.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return { levels, byId, byWorld, skills, levelDirs };
}
