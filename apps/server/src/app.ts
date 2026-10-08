import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { CoachRuleSchema, type CoachRule } from '@terminal-quest/shared';
import { loadLevels, type LoadedLevels } from './engine/levelLoader.js';
import { getDb, type Db } from './db/client.js';
import type { User } from './db/schema.js';
import { userFromToken, requestToken } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { discoverContentRoot } from './contentRoot.js';
import { logger } from './util/logger.js';
import { DockerProvider } from './sandbox/dockerProvider.js';
import type { SandboxProvider } from './sandbox/provider.js';
import { SessionManager } from './sandbox/sessionManager.js';
import { Reaper } from './sandbox/reaper.js';
import { LiveSessionRegistry } from './ws/liveSession.js';
import { loadBadges } from './progression/badges.js';
import { endAttempt } from './progression/attempts.js';
import { closeLiveSession } from './ws/sessionFlow.js';
import { registerSessionSocket } from './ws/sessionSocket.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerWorldsRoutes } from './routes/worlds.js';
import { registerLevelRoutes } from './routes/levels.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerSessionRoutes } from './routes/sessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    levels: LoadedLevels;
    provider: SandboxProvider;
    manager: SessionManager;
    live: LiveSessionRegistry;
    coachRules: CoachRule[];
  }
  interface FastifyRequest {
    user?: User;
  }
}

export interface BuildAppOptions {
  db?: Db;
  contentRoot?: string;
  config?: AppConfig;
  socketPath?: string;
  startReaper?: boolean;
}

function loadCoachRules(contentRoot: string): CoachRule[] {
  const file = join(dirname(contentRoot), 'coach.yaml');
  const raw = parseYaml(readFileSync(file, 'utf8')) as unknown;
  return z.array(CoachRuleSchema).parse(raw);
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? getDb();
  const contentRoot = opts.contentRoot ?? discoverContentRoot();
  const levels = loadLevels(contentRoot);
  const coachRules = loadCoachRules(contentRoot);
  const badgeList = loadBadges(join(dirname(contentRoot), 'badges.yaml'));
  const provider = new DockerProvider({ socketPath: opts.socketPath ?? config.DOCKER_SOCKET });
  const live = new LiveSessionRegistry();
  const manager = new SessionManager({
    provider,
    maxContainers: config.MAX_CONTAINERS,
    idleTtlMs: config.IDLE_TTL_SECONDS * 1000,
    maxAgeMs: config.MAX_AGE_SECONDS * 1000,
    onExpire: (id, reason) => {
      const expired = live.get(id);
      live.delete(id);
      if (expired === undefined) {
        return;
      }
      if (!expired.attemptFinished) {
        try {
          endAttempt(db, expired.attemptId, 'expired');
        } catch (err) {
          logger.warn({ err, id }, 'failed to mark expired attempt');
        }
      }
      if (expired.socket !== undefined) {
        expired.socket.send(JSON.stringify({ t: 'closing', reason }));
        expired.socket.close();
        expired.socket = undefined;
      }
    },
  });

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('levels', levels);
  app.decorate('provider', provider);
  app.decorate('manager', manager);
  app.decorate('live', live);
  app.decorate('coachRules', coachRules);

  const flowDeps = {
    provider,
    manager,
    live,
    coachRules,
    badgeList,
    skills: levels.skills,
    db,
    levelsByWorld: levels.byWorld,
    levelsById: levels.byId,
    levelDirs: levels.levelDirs,
    unlockAll: config.UNLOCK_ALL === 1,
  };

  await app.register(cookie);
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
  await app.register(websocket);

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
  await registerProgressRoutes(app);
  await registerSessionRoutes(app, { ...flowDeps, config });
  await registerSessionSocket(app, { ...flowDeps, config });

  const reaper = new Reaper(manager, logger);
  if (opts.startReaper ?? true) {
    try {
      await reaper.start();
    } catch (err) {
      // Boot without Docker must still work (/healthz reports docker:false).
      logger.warn({ err }, 'reaper boot sweep failed; continuing without it');
    }
  }

  app.addHook('onClose', async () => {
    reaper.stop();
    for (const active of [...live.values()]) {
      await closeLiveSession(flowDeps, active, 'server_shutdown');
    }
  });

  return app;
}

export { logger };
