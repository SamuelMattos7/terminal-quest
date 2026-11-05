import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { CoachRuleSchema, MAX_CLIENT_FRAME_BYTES, type CoachRule } from '@terminal-quest/shared';
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
import { loadBadges, type Badge } from './progression/badges.js';
import { closeLiveSession } from './ws/sessionFlow.js';
import { invalidateLiveSession } from './ws/sessionCleanup.js';
import { registerSessionSocket } from './ws/sessionSocket.js';
import { registerHealthRoute } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerWorldsRoutes } from './routes/worlds.js';
import { registerLevelRoutes } from './routes/levels.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerWebDelivery } from './webDelivery.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
    levels: LoadedLevels;
    provider: SandboxProvider;
    manager: SessionManager;
    live: LiveSessionRegistry;
    coachRules: CoachRule[];
    badgeList: Badge[];
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
  webRoot?: string;
}

function loadCoachRules(contentRoot: string): CoachRule[] {
  const file = join(dirname(contentRoot), 'coach.yaml');
  const raw = parseYaml(readFileSync(file, 'utf8')) as unknown;
  return z.array(CoachRuleSchema).parse(raw);
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const production = opts.webRoot !== undefined;
  const app = Fastify({
    logger: false,
    // Caddy connects over IPv4 loopback. Stop at its immediate client.
    trustProxy: production && ((address, hop) => address === '127.0.0.1' && hop === 0),
  });
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
      if (expired === undefined) {
        return;
      }
      invalidateLiveSession(flowDeps, expired, reason);
    },
  });

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('levels', levels);
  app.decorate('provider', provider);
  app.decorate('manager', manager);
  app.decorate('live', live);
  app.decorate('coachRules', coachRules);
  app.decorate('badgeList', badgeList);

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
  const reaper = new Reaper(manager, logger);
  let earlyCleanup: Promise<void> | undefined;
  // Run before the WebSocket plugin closes upgraded connections so clients
  // can receive the shutdown frame. onClose handles any HTTP launches still draining.
  app.addHook('preClose', async () => {
    reaper.stop();
    earlyCleanup = closeActiveSessions();
  });
  await app.register(websocket, {
    options: { maxPayload: MAX_CLIENT_FRAME_BYTES, perMessageDeflate: false },
  });

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
  await registerAuthRoutes(app, production);
  await registerMeRoutes(app);
  await registerWorldsRoutes(app);
  await registerLevelRoutes(app);
  await registerProgressRoutes(app);
  await registerSessionRoutes(app, { ...flowDeps, config });
  await registerSessionSocket(app, { ...flowDeps, config });

  if (opts.webRoot !== undefined) {
    await registerWebDelivery(app, opts.webRoot, config.PUBLIC_ORIGIN);
  }

  if (opts.startReaper ?? true) {
    try {
      await reaper.start();
    } catch (err) {
      // Boot without Docker must still work (/healthz reports docker:false).
      logger.warn(
        { err },
        'reaper boot sweep failed; periodic cleanup and orphan retries remain active',
      );
    }
  }

  async function closeActiveSessions(): Promise<void> {
    await Promise.all(
      [...live.values()].map(async (active) => {
        try {
          await closeLiveSession(flowDeps, active, 'server_shutdown');
        } catch (err) {
          logger.warn(
            { err, attemptId: active.attemptId, levelId: active.level.id },
            'shutdown session cleanup failed; retrying sandbox teardown',
          );
        }
      }),
    );
  }

  app.addHook('onClose', async () => {
    await Promise.all([earlyCleanup, closeActiveSessions()]);
    // Includes failed launches/manual closes that no longer have a live entry.
    await manager.closeAll();
  });

  return app;
}

export { logger };
