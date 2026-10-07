import type { FastifyInstance } from 'fastify';
import { GuestResponseSchema } from '@terminal-quest/shared';
import {
  createGuest,
  setSessionCookie,
  toUserShape,
  userFromToken,
  requestToken,
} from '../auth.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/guest', async (request, reply) => {
    const existing = await userFromToken(app.db, requestToken(request));
    if (existing !== undefined) {
      return reply.send(GuestResponseSchema.parse({ user: toUserShape(existing) }));
    }
    const { user, token } = await createGuest(app.db);
    setSessionCookie(reply, token);
    return reply.send(GuestResponseSchema.parse({ user: toUserShape(user) }));
  });
}
