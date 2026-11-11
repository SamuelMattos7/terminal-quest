import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export async function registerRequestLimits(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });
  // Apply the IP budget to every request, including routes with user limits.
  app.addHook('onRequest', app.rateLimit());

  // Each plugin instance has its own per-request "already counted" marker.
  // A separate instance lets route-level limits run in addition to the IP
  // hook; a single instance treats route configuration as an override.
  await app.register(rateLimit, { global: false });
}
