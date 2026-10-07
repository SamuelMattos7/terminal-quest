import type { FastifyInstance } from 'fastify';
import { toPublicLevel } from '@terminal-quest/shared';

export async function registerLevelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/levels/:id', async (request, reply) => {
    if (request.user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { id } = request.params as { id: string };
    const level = app.levels.byId.get(id);
    if (level === undefined) {
      return reply.code(404).send({ error: 'unknown level' });
    }
    return reply.send(toPublicLevel(level));
  });
}
