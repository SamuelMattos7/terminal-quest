import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WorldsResponseSchema, type LevelState } from '@terminal-quest/shared';
import { levelProgress } from '../db/schema.js';
import { WORLDS } from '../engine/worlds.js';
import { levelStates } from '../progression/unlock.js';

export async function registerWorldsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/worlds', async (request, reply) => {
    const user = request.user;
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const rows = await app.db
      .select()
      .from(levelProgress)
      .where(eq(levelProgress.userId, user.id))
      .all();
    const completed = new Set(rows.filter((r) => r.completions > 0).map((r) => r.levelId));
    const bestRank = new Map(rows.map((r) => [r.levelId, r.bestRank]));
    const states = levelStates(app.levels.byWorld, completed, app.config.UNLOCK_ALL === 1);
    const worlds = WORLDS.filter((w) => app.config.ENABLE_WORLDS.includes(w.id)).map((w) => ({
      id: w.id,
      title: w.title,
      blurb: w.blurb,
      levels: (app.levels.byWorld.get(w.id) ?? []).map((l) => ({
        id: l.id,
        title: l.title,
        kind: l.kind,
        difficulty: l.difficulty,
        estimatedMinutes: l.estimated_minutes,
        state: (states.get(l.id) ?? 'locked') as LevelState,
        ...(bestRank.get(l.id) != null
          ? { bestRank: bestRank.get(l.id) as 'S' | 'A' | 'B' | 'C' }
          : {}),
      })),
    }));
    return reply.send(WorldsResponseSchema.parse({ worlds }));
  });
}
