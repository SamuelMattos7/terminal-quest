import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { MeResponseSchema } from '@terminal-quest/shared';
import { badges } from '../db/schema.js';
import { playerLevel, xpToNext } from '../progression/xp.js';
import { toUserShape } from '../auth.js';

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', async (request, reply) => {
    const user = request.user;
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const earned = await app.db.select().from(badges).where(eq(badges.userId, user.id)).all();
    return reply.send(
      MeResponseSchema.parse({
        user: toUserShape(user),
        playerLevel: playerLevel(user.xp),
        xpToNext: xpToNext(user.xp),
        badges: earned.map((b) => b.badgeId),
      }),
    );
  });
}
