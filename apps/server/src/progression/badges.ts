import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { eq } from 'drizzle-orm';
import type { Level } from '@terminal-quest/shared';
import { attempts, badges, levelProgress, users } from '../db/schema.js';
import type { Db } from '../db/client.js';

// Badge catalog + evaluators for plan.md §10.4. `rule` keys map to the
// functions below; level/world-specific rules activate as content lands.

export const BadgeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    rule: z.string().min(1),
    level: z.string().min(1).optional(),
    world: z.number().int().min(1).optional(),
  })
  .strict();

export type Badge = z.infer<typeof BadgeSchema>;

export function loadBadges(badgesFile: string): Badge[] {
  return z.array(BadgeSchema).parse(parseYaml(readFileSync(badgesFile, 'utf8')) as unknown);
}

const RANK_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };

function rankAtLeast(rank: string | null, best: 'B'): boolean {
  if (rank === null) {
    return false;
  }
  return (RANK_ORDER[rank] ?? 99) <= (RANK_ORDER[best] ?? 99);
}

export interface BadgeEvent {
  levelId: string;
  rank: string;
  commands: string[];
  hintsUsed: number;
}

export interface BadgeCatalog {
  badges: Badge[];
  levelsById: Map<string, Level>;
  levelsByWorld: Map<number, Level[]>;
}

function worldLevels(catalog: BadgeCatalog, world: number): string[] {
  return (catalog.levelsByWorld.get(world) ?? []).map((l) => l.id);
}

async function ruleHolds(
  db: Db,
  userId: string,
  badge: Badge,
  event: BadgeEvent,
  catalog: BadgeCatalog,
  completedIds: Set<string>,
): Promise<boolean> {
  switch (badge.rule) {
    case 'first-command':
      return true;
    case 'pipe-dream':
      return event.commands.some((c) => c.split('|').length - 1 >= 3);
    case 'no-hints-world': {
      const level = catalog.levelsById.get(event.levelId);
      if (level === undefined) {
        return false;
      }
      const ids = worldLevels(catalog, level.world);
      if (!ids.every((id) => completedIds.has(id))) {
        return false;
      }
      const rows = await db.select().from(attempts).where(eq(attempts.userId, userId)).all();
      return rows.filter((r) => ids.includes(r.levelId)).every((r) => r.hintsUsed === 0);
    }
    case 'level-done':
      return badge.level !== undefined && completedIds.has(badge.level);
    case 'cron-whisperer': {
      const rows = await db
        .select()
        .from(levelProgress)
        .where(eq(levelProgress.userId, userId))
        .all();
      const byId = new Map(rows.map((r) => [r.levelId, r.bestRank]));
      return (
        rankAtLeast(byId.get('w4-12-cron-basics') ?? null, 'B') &&
        rankAtLeast(byId.get('w4-13-cron-pitfalls') ?? null, 'B')
      );
    }
    case 'streak-3':
    case 'streak-7': {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).all();
      return (user?.streakDays ?? 0) >= (badge.rule === 'streak-7' ? 7 : 3);
    }
    case 's-rank-10': {
      const rows = await db.select().from(attempts).where(eq(attempts.userId, userId)).all();
      return rows.filter((r) => r.rank === 'S').length >= 10;
    }
    case 'boss-done': {
      if (badge.world === undefined) {
        return false;
      }
      return (catalog.levelsByWorld.get(badge.world) ?? []).some(
        (l) => l.kind === 'boss' && completedIds.has(l.id),
      );
    }
    default:
      return false;
  }
}

/** Evaluate all rules after a completion; insert + return newly earned ids. */
export async function evaluateBadges(
  db: Db,
  userId: string,
  badgeList: Badge[],
  event: BadgeEvent,
  catalog: Omit<BadgeCatalog, 'badges'>,
  completedIds: Set<string>,
  now = Date.now(),
): Promise<string[]> {
  const earned = new Set(
    (await db.select().from(badges).where(eq(badges.userId, userId)).all()).map((b) => b.badgeId),
  );
  const fresh: string[] = [];
  for (const badge of badgeList) {
    if (earned.has(badge.id)) {
      continue;
    }
    if (
      await ruleHolds(db, userId, badge, event, { ...catalog, badges: badgeList }, completedIds)
    ) {
      await db
        .insert(badges)
        .values({ userId, badgeId: badge.id, earnedAt: Math.floor(now / 1000) })
        .onConflictDoNothing()
        .run();
      earned.add(badge.id);
      fresh.push(badge.id);
    }
  }
  return fresh;
}
