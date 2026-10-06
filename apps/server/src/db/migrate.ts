import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../config.js';
import { logger } from '../util/logger.js';
import { closeDb, createDb } from './client.js';

// `pnpm db:migrate`: create the parent dir, then apply every migration in
// `src/db/migrations/`. Re-runs are no-ops once the journal is current.
const config = loadConfig();
mkdirSync(dirname(config.DB_PATH), { recursive: true });

const db = createDb(config.DB_PATH);
try {
  migrate(db, {
    migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
  });
  logger.info({ dbPath: config.DB_PATH }, 'database migrated');
} finally {
  closeDb(db);
}
