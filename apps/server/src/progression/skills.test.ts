import { describe, expect, it } from 'vitest';
import type { Skill } from '@terminal-quest/shared';
import { skillProgress } from '../db/schema.js';
import { makeTempDb, makeUser } from '../testUtils.js';
import { creditSkills } from './skills.js';

const pwd: Skill = { id: 'pwd', title: 'pwd', group: 'navigation', world: 1, prereqs: [] };
const grep: Skill = {
  id: 'grep',
  title: 'grep',
  group: 'searching',
  world: 2,
  prereqs: [],
  detect: '^(\\S+\\s+)*grep\\b',
};
const skills = new Map([
  ['pwd', pwd],
  ['grep', grep],
]);

function rows(
  db: ReturnType<typeof makeTempDb>['db'],
  userId: string,
): Record<string, number | string | null>[] {
  return db
    .select()
    .from(skillProgress)
    .all()
    .filter((r) => r.userId === userId)
    .map((r) => ({
      skill: r.skillId,
      uses: r.uses,
      levels: r.levelsUsedJson,
      mastered: r.masteredAt,
    }));
}

describe('creditSkills', () => {
  it('credits teaches, accumulates levels, and masters at three', () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      for (const levelId of ['w1-01-a', 'w1-02-b', 'w1-03-c']) {
        creditSkills(db, {
          userId,
          levelId,
          teaches: ['pwd'],
          skills,
          successfulCommands: ['pwd'],
          now: 1000,
        });
      }
      const pwdRow = rows(db, userId).find((r) => r.skill === 'pwd');
      expect(pwdRow).toMatchObject({ uses: 3 });
      expect(JSON.parse(String(pwdRow?.levels))).toEqual(['w1-01-a', 'w1-02-b', 'w1-03-c']);
      expect(pwdRow?.mastered).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('counts detect hits in successful commands toward mastery, not uses', () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      for (const levelId of ['w2-01-a', 'w2-02-b', 'w2-03-c']) {
        creditSkills(db, {
          userId,
          levelId,
          teaches: ['pwd'],
          skills,
          successfulCommands: ['grep foo bar.txt'],
          now: 1000,
        });
      }
      const grepRow = rows(db, userId).find((r) => r.skill === 'grep');
      expect(grepRow).toMatchObject({ uses: 0 });
      expect(grepRow?.mastered).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('ignores failed commands for detect and unknown skills entirely', () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      creditSkills(db, {
        userId,
        levelId: 'w1-01-a',
        teaches: ['nope'],
        skills,
        successfulCommands: [],
        now: 1,
      });
      expect(rows(db, userId)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
