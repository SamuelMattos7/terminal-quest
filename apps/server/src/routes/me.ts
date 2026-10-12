import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  DisplayNameRequestSchema,
  GuestResponseSchema,
  MeResponseSchema,
} from '@terminal-quest/shared';
import { badges, users } from '../db/schema.js';
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

  // Profile display-name edit (D-014, T4.3). Names are trimmed, 1–40 chars.
  app.patch('/api/me', async (request, reply) => {
    const user = request.user;
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const parsed = DisplayNameRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'displayName must be 1–40 characters' });
    }
    await app.db
      .update(users)
      .set({ displayName: parsed.data.displayName })
      .where(eq(users.id, user.id))
      .run();
    const [updated] = await app.db.select().from(users).where(eq(users.id, user.id)).all();
    if (updated === undefined) {
      return reply.code(404).send({ error: 'unknown user' });
    }
    return reply.send(GuestResponseSchema.parse({ user: toUserShape(updated) }));
  });
}
