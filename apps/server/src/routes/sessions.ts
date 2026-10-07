import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { OkResponseSchema, StartSessionResponseSchema, type Level } from '@terminal-quest/shared';
import { levelProgress } from '../db/schema.js';
import { CapacityError } from '../sandbox/sessionManager.js';
import { levelStates } from '../progression/unlock.js';
import { SetupFailedError } from '../engine/setupRunner.js';
import {
  closeLiveSession,
  launchLevelSession,
  randomSeed,
  type FlowDeps,
} from '../ws/sessionFlow.js';

// Attempt lifecycle endpoints for plan.md §4.1/§6 (T3.2). No attempt-table
// writes here — T3.3 owns persistence; scoring reads level_progress only.

export interface SessionRouteDeps extends FlowDeps {
  config: { UNLOCK_ALL: number };
  levelsByWorld: Map<number, Level[]>;
  levelsById: Map<string, Level>;
  levelDirs: Map<string, string>;
}

async function completedIds(deps: SessionRouteDeps, userId: string): Promise<Set<string>> {
  const rows = await deps.db
    .select()
    .from(levelProgress)
    .where(eq(levelProgress.userId, userId))
    .all();
  return new Set(rows.filter((r) => r.completions > 0).map((r) => r.levelId));
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  deps: SessionRouteDeps,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/levels/:id/start',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.user?.id ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const level = deps.levelsById.get(request.params.id);
      if (level === undefined) {
        return reply.code(404).send({ error: 'unknown level' });
      }
      const states = levelStates(
        deps.levelsByWorld,
        await completedIds(deps, user.id),
        deps.config.UNLOCK_ALL === 1,
      );
      if (states.get(level.id) === 'locked') {
        return reply.code(403).send({ error: 'level locked' });
      }
      const levelDir = deps.levelDirs.get(level.id);
      if (levelDir === undefined) {
        return reply.code(500).send({ error: 'level content missing' });
      }
      const previous = deps.live.getByUser(user.id);
      if (previous !== undefined) {
        await closeLiveSession(deps, previous, 'replaced');
      }
      try {
        const live = await launchLevelSession(deps, user.id, level, levelDir, randomSeed());
        return reply.send(
          StartSessionResponseSchema.parse({
            sessionId: live.session.id,
            wsPath: `/ws/sessions/${live.session.id}`,
          }),
        );
      } catch (err) {
        if (err instanceof CapacityError) {
          return reply
            .header('Retry-After', '30')
            .code(429)
            .send({ error: 'sandbox capacity reached' });
        }
        if (err instanceof SetupFailedError) {
          request.log.error({ err }, 'level setup failed');
          return reply.code(500).send({ error: 'level setup failed' });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/sessions/:id/reset', async (request, reply) => {
    const user = request.user;
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const live = deps.live.get(request.params.id);
    if (live === undefined) {
      return reply.code(404).send({ error: 'unknown session' });
    }
    if (live.userId !== user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const levelDir = deps.levelDirs.get(live.level.id);
    if (levelDir === undefined) {
      return reply.code(500).send({ error: 'level content missing' });
    }
    await closeLiveSession(deps, live, 'replaced');
    try {
      const fresh = await launchLevelSession(deps, user.id, live.level, levelDir, randomSeed());
      return reply.send(
        StartSessionResponseSchema.parse({
          sessionId: fresh.session.id,
          wsPath: `/ws/sessions/${fresh.session.id}`,
        }),
      );
    } catch (err) {
      if (err instanceof CapacityError) {
        return reply
          .header('Retry-After', '30')
          .code(429)
          .send({ error: 'sandbox capacity reached' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const user = request.user;
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const live = deps.live.get(request.params.id);
    if (live === undefined) {
      return reply.code(404).send({ error: 'unknown session' });
    }
    if (live.userId !== user.id) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    await closeLiveSession(deps, live, 'abandoned');
    return reply.send(OkResponseSchema.parse({ ok: true }));
  });
}
