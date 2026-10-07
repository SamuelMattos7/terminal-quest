import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadLevels, type LoadedLevels } from './engine/levelLoader.js';
import { getDb, type Db } from './db/client.js';
import type { User } from './db/schema.js';
import { userFromToken, requestToken } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { discoverContentRoot } from './contentRoot.js';
import { logger } from './util/logger.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerWorldsRoutes } from './routes/worlds.js';
import { registerLevelRoutes } from './routes/levels.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    levels: LoadedLevels;
  }
  interface FastifyRequest {
    user?: User;
  }
}

export interface BuildAppOptions {
  db?: Db;
  contentRoot?: string;
  config?: AppConfig;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? getDb();
  const levels = loadLevels(opts.contentRoot ?? discoverContentRoot());

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('levels', levels);

  await app.register(cookie);
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  // Session auth for /api/* (guest creation itself is public).
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }
    if (request.method === 'POST' && request.url === '/api/guest') {
      return;
    }
    const user = await userFromToken(db, requestToken(request));
    if (user === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.user = user;
  });

  await registerHealthRoute(app, config);
  await registerAuthRoutes(app);
  await registerMeRoutes(app);
  await registerWorldsRoutes(app);
  await registerLevelRoutes(app);
  return app;
}

export { logger };
