import { describe, expect, it } from 'vitest';
import type { Level } from '@terminal-quest/shared';
import { attempts, levelProgress, users } from '../db/schema.js';
import { makeTempDb, makeUser } from '../testUtils.js';
import { evaluateBadges, loadBadges, type Badge } from './badges.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function level(id: string, world: number, kind: 'lesson' | 'boss' = 'lesson'): Level {
  return {
    id,
    world,
    order: 1,
    title: id,
    kind,
    difficulty: 1,
    estimated_minutes: 3,
    story: 'story',
    teaches: ['pwd'],
    par_commands: 2,
    xp: 50,
    sandbox: {
      profile: 'basic',
      network: 'none',
      sidecars: [],
      image: 'tq-base',
      start_cwd: '/home/player',
      resources: { memory_mb: 256, cpus: 0.5, pids: 128 },
      capabilities: [],
      sudo_allow: [],
      needs_cron: true,
    },
    objectives: [],
    hints: ['a', 'b', 'c'],
    coach: [],
    explain: [],
    cheatsheet: [],
    success_message: 'done',
    forbidden_commands: [],
    solutions: { reference: 'solution.sh', wrong: [] },
  };
}

const catalog = {
  levelsById: new Map([
    ['w1-01-a', level('w1-01-a', 1)],
    ['w1-12-boss', level('w1-12-boss', 1, 'boss')],
  ]),
  levelsByWorld: new Map([[1, [level('w1-01-a', 1), level('w1-12-boss', 1, 'boss')]]]),
};

const allBadges: Badge[] = [
  { id: 'first-command', title: 'F', description: 'D', rule: 'first-command' },
  { id: 'pipe-dream', title: 'P', description: 'D', rule: 'pipe-dream' },
  { id: 'boss-1', title: 'B', description: 'D', rule: 'boss-done', world: 1 },
  { id: 's-rank-10', title: 'S', description: 'D', rule: 's-rank-10' },
  { id: 'streak-3', title: 'T', description: 'D', rule: 'streak-3' },
  { id: 'no-hints-world', title: 'N', description: 'D', rule: 'no-hints-world' },
];

const event = { levelId: 'w1-01-a', rank: 'A', commands: ['ls'], hintsUsed: 0 };

describe('real badges.yaml', () => {
  it('parses the shipped catalog', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const badges = loadBadges(
      resolve(here, '..', '..', '..', '..', 'packages', 'levels', 'badges.yaml'),
    );
    expect(badges.length).toBeGreaterThanOrEqual(14);
    expect(badges.map((b) => b.id)).toContain('first-command');
  });
});

describe('evaluateBadges', () => {
  it('awards first-command once and never twice', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const first = await evaluateBadges(
        db,
        userId,
        allBadges,
        event,
        catalog,
        new Set(['w1-01-a']),
      );
      expect(first).toContain('first-command');
      const second = await evaluateBadges(
        db,
        userId,
        allBadges,
        event,
        catalog,
        new Set(['w1-01-a']),
      );
      expect(second).not.toContain('first-command');
    } finally {
      cleanup();
    }
  });

  it('detects pipelines, bosses, S-ranks, and streaks', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      const piped = await evaluateBadges(
        db,
        userId,
        allBadges,
        { ...event, commands: ['cat a | grep b | sort | uniq -c'] },
        catalog,
        new Set(['w1-01-a']),
      );
      expect(piped).toContain('pipe-dream');
      expect(piped).not.toContain('boss-1');

      const bossed = await evaluateBadges(
        db,
        userId,
        allBadges,
        { ...event, levelId: 'w1-12-boss' },
        catalog,
        new Set(['w1-01-a', 'w1-12-boss']),
      );
      expect(bossed).toContain('boss-1');

      for (let i = 0; i < 10; i++) {
        db.insert(attempts)
          .values({
            id: `a${i}`,
            userId,
            levelId: 'w1-01-a',
            seed: i,
            startedAt: 1,
            status: 'completed',
            rank: 'S',
          })
          .run();
      }
      const ranked = await evaluateBadges(
        db,
        userId,
        allBadges,
        event,
        catalog,
        new Set(['w1-01-a']),
      );
      expect(ranked).toContain('s-rank-10');

      db.update(users).set({ streakDays: 3 }).run();
      const streaked = await evaluateBadges(
        db,
        userId,
        allBadges,
        event,
        catalog,
        new Set(['w1-01-a']),
      );
      expect(streaked).toContain('streak-3');
    } finally {
      cleanup();
    }
  });

  it('grants no-hints-world only for hintless worlds', async () => {
    const { db, cleanup } = makeTempDb();
    try {
      const userId = makeUser(db);
      db.insert(levelProgress)
        .values([
          { userId, levelId: 'w1-01-a', completions: 1 },
          { userId, levelId: 'w1-12-boss', completions: 1 },
        ])
        .run();
      db.insert(attempts)
        .values([
          {
            id: 'a1',
            userId,
            levelId: 'w1-01-a',
            seed: 1,
            startedAt: 1,
            status: 'completed',
            hintsUsed: 0,
          },
          {
            id: 'a2',
            userId,
            levelId: 'w1-12-boss',
            seed: 1,
            startedAt: 1,
            status: 'completed',
            hintsUsed: 1,
          },
        ])
        .run();
      const dirty = await evaluateBadges(
        db,
        userId,
        allBadges,
        { ...event, levelId: 'w1-12-boss' },
        catalog,
        new Set(['w1-01-a', 'w1-12-boss']),
      );
      expect(dirty).not.toContain('no-hints-world');

      db.update(attempts).set({ hintsUsed: 0 }).run();
      const clean = await evaluateBadges(
        db,
        userId,
        allBadges,
        { ...event, levelId: 'w1-12-boss' },
        catalog,
        new Set(['w1-01-a', 'w1-12-boss']),
      );
      expect(clean).toContain('no-hints-world');
    } finally {
      cleanup();
    }
  });
});
