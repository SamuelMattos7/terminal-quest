import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { buildApp, logger } from './app.js';

const config = loadConfig();
const app = await buildApp({
  config,
  // Resolve from the installed module so systemd's cwd cannot change delivery.
  // tsx development uses Vite's separate server and must not require a web build.
  webRoot: import.meta.url.endsWith('.js')
    ? fileURLToPath(new URL('../../web/dist/', import.meta.url))
    : undefined,
});

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'server listening');
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}
