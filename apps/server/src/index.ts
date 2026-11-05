import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { buildApp, logger } from './app.js';

const config = loadConfig();
const production = import.meta.url.endsWith('.js');
const app = await buildApp({
  config,
  // Resolve from the installed module so systemd's cwd cannot change delivery.
  // tsx development uses Vite's separate server and must not require a web build.
  webRoot: production ? fileURLToPath(new URL('../../web/dist/', import.meta.url)) : undefined,
});

const listening = app.listen({ port: config.PORT, host: production ? '127.0.0.1' : '0.0.0.0' });
let closing: Promise<void> | undefined;
function shutdown(signal: NodeJS.Signals): void {
  closing ??= (async () => {
    logger.info({ signal }, 'server shutting down');
    try {
      await listening.catch(() => undefined);
      await app.close();
      logger.info('server shut down');
    } catch (err) {
      logger.error({ err }, 'server shutdown failed');
      process.exitCode = 1;
    }
  })();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await listening;
  logger.info({ port: config.PORT }, 'server listening');
} catch (err) {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
}
