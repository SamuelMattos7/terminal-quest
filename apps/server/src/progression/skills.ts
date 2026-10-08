import { and, eq } from 'drizzle-orm';
import type { Skill } from '@terminal-quest/shared';
import { skillProgress } from '../db/schema.js';
import type { Db } from '../db/client.js';

// Skill credit for plan.md §10.3. Each taught skill gets uses += 1; a skill
// counts a level once it is taught there or its detect regex hits a
// successful command. Mastered at 3 distinct levels.

function parseLevels(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export interface SkillCreditInput {
  userId: string;
  levelId: string;
  teaches: string[];
  skills: Map<string, Skill>;
  successfulCommands: string[];
  now?: number;
}

export function creditSkills(db: Db, input: SkillCreditInput): void {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  for (const skill of input.skills.values()) {
    const taught = input.teaches.includes(skill.id);
    const detected =
      skill.detect !== undefined &&
      input.successfulCommands.some((c) => new RegExp(skill.detect as string).test(c));
    if (!taught && !detected) {
      continue;
    }
    const [row] = db
      .select()
      .from(skillProgress)
      .where(and(eq(skillProgress.userId, input.userId), eq(skillProgress.skillId, skill.id)))
      .all();
    const levels = new Set(row !== undefined ? parseLevels(row.levelsUsedJson) : []);
    levels.add(input.levelId);
    if (row === undefined) {
      db.insert(skillProgress)
        .values({
          userId: input.userId,
          skillId: skill.id,
          uses: taught ? 1 : 0,
          levelsUsedJson: JSON.stringify([...levels]),
          masteredAt: levels.size >= 3 ? now : null,
          lastUsedAt: now,
        })
        .run();
      continue;
    }
    db.update(skillProgress)
      .set({
        uses: row.uses + (taught ? 1 : 0),
        levelsUsedJson: JSON.stringify([...levels]),
        masteredAt: row.masteredAt ?? (levels.size >= 3 ? now : null),
        lastUsedAt: now,
      })
      .where(and(eq(skillProgress.userId, input.userId), eq(skillProgress.skillId, skill.id)))
      .run();
  }
}
