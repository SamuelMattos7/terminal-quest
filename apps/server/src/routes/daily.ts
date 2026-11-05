import { DailyResponseSchema } from '@terminal-quest/shared';
import { and, eq, gt, gte, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { attempts, levelProgress } from '../db/schema.js';
import { dailyLevel, isDailyEligible } from '../progression/daily.js';
import { dayString } from '../progression/streaks.js';
import { levelStates } from '../progression/unlock.js';

export async function registerDailyRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/daily', async (request, reply) => {
    const userId = request.user?.id;
    if (userId === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const date = dayString(Date.now());
    const rows = app.db
      .select({ levelId: levelProgress.levelId })
      .from(levelProgress)
      .where(and(eq(levelProgress.userId, userId), gt(levelProgress.completions, 0)))
      .all();
    const completed = new Set(rows.map((row) => row.levelId));
    const states = levelStates(
      app.levels.byWorld,
      completed,
      app.config.UNLOCK_ALL === 1,
      app.config.ENABLE_WORLDS,
    );
    const pool = [...app.levels.byWorld.values()]
      .flatMap((levels) => {
        const bosses = levels.filter((level) => level.kind === 'boss');
        const worldCompleted = bosses.length > 0 && bosses.every((boss) => completed.has(boss.id));
        return levels.filter((level) => {
          const state = states.get(level.id);
          return (
            (state === 'available' || state === 'completed') &&
            isDailyEligible(level, worldCompleted)
          );
        });
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const picked = dailyLevel(pool, date);
    if (picked === undefined) {
      return reply.code(404).send({ error: 'no daily level' });
    }

    // Attempt end times are stored in Unix seconds; the upper bound is the next UTC midnight.
    const start = Date.parse(`${date}T00:00:00Z`) / 1000;
    const match = app.db
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.levelId, picked.id),
          eq(attempts.status, 'completed'),
          gte(attempts.endedAt, start),
          lt(attempts.endedAt, start + 86_400),
        ),
      )
      .limit(1)
      .get();
    return reply.send(
      DailyResponseSchema.parse({ levelId: picked.id, date, completed: match !== undefined }),
    );
  });
}
