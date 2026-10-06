import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { loadConfig } from '../config.js';
import * as schema from './schema.js';

// `$client` is attached by drizzle's factory (not the class), so it is
// part of our alias explicitly.
export type Db = BetterSQLite3Database<typeof schema> & { $client: DatabaseType };

export function createDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

export function closeDb(db: Db): void {
  db.$client.close();
}

let instance: Db | undefined;

/** Production singleton keyed on `DB_PATH`. Tests must use `createDb` directly. */
export function getDb(dbPath?: string): Db {
  if (instance === undefined) {
    const path = dbPath ?? loadConfig().DB_PATH;
    instance = createDb(path);
  }
  return instance;
}
