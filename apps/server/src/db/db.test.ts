import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from './client.js';
import { authTokens, users } from './schema.js';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

describe('db', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tq-db-test-'));
    db = createDb(join(dir, 'test.sqlite'));
    migrate(db, { migrationsFolder });
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrates all eight §5 tables', () => {
    const names = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    for (const expected of [
      'users',
      'auth_tokens',
      'attempts',
      'level_progress',
      'skill_progress',
      'spellbook_notes',
      'badges',
      'events',
    ]) {
      expect(names.map((r) => r.name)).toContain(expected);
    }
  });

  it('inserts and reads a user with defaults', () => {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    db.insert(users).values({ id, createdAt: now }).run();
    const [row] = db.select().from(users).where(eq(users.id, id)).all();
    expect(row).toMatchObject({ id, createdAt: now, xp: 0, streakDays: 0 });
  });

  it('links an auth token to its user', () => {
    const userId = randomUUID();
    db.insert(users).values({ id: userId, createdAt: 1 }).run();
    db.insert(authTokens).values({ tokenHash: 'abc123', userId, createdAt: 2 }).run();
    const [row] = db.select().from(authTokens).where(eq(authTokens.tokenHash, 'abc123')).all();
    expect(row?.userId).toBe(userId);
  });
});
