import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { logger } from './util/logger.js';

export function buildApp() {
  const app = Fastify({ logger: false });
  const config = loadConfig();
  void registerHealthRoute(app, config);
  return { app, config };
}

const { app, config } = buildApp();

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'server listening');
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}
