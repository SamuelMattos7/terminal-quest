import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { testConfig, type AppConfig } from './config.js';
import { closeDb, createDb, type Db } from './db/client.js';

// Shared scaffolding for API route tests: an isolated temp-file database
// (migrated) and a fixture content tree. Nothing touches Docker.

const migrationsFolder = fileURLToPath(new URL('./db/migrations', import.meta.url));

export interface FixtureLevel {
  dir: string;
  level: Record<string, unknown>;
}

export function makeLevel(id: string, world: number, order: number, kind = 'lesson'): FixtureLevel {
  const nn = String(order).padStart(2, '0');
  return {
    dir: `w${world}/${nn}-${id}`,
    level: {
      id: `w${world}-${nn}-${id}`,
      world,
      order,
      title: `Title ${id}`,
      kind,
      difficulty: 1,
      estimated_minutes: 3,
      story: 'A short story.',
      teaches: ['pwd'],
      par_commands: 2,
      xp: 50,
      objectives: [
        {
          id: 'did-it',
          text: 'Do it.',
          check: { type: 'file_exists', path: '/home/player/a.txt' },
        },
      ],
      hints: ['one', 'two', 'three'],
      success_message: 'Done.',
      solutions: { reference: 'solution.sh' },
    },
  };
}

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  cleanup: () => void;
}

export async function makeTestContext(
  fixtures: FixtureLevel[] = [makeLevel('first', 1, 1)],
  configOverrides: Partial<AppConfig> = {},
  contentRoot?: string,
): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'tq-api-test-'));
  const root = contentRoot ?? join(dir, 'content');
  if (contentRoot === undefined) {
    writeFileSync(
      join(dir, 'skills.yaml'),
      stringifyYaml([{ id: 'pwd', title: 'pwd', group: 'navigation', world: 1 }]),
    );
    writeFileSync(join(dir, 'coach.yaml'), stringifyYaml([]));
    for (const fixture of fixtures) {
      const levelDir = join(root, fixture.dir);
      mkdirSync(levelDir, { recursive: true });
      writeFileSync(join(levelDir, 'level.yaml'), stringifyYaml(fixture.level));
    }
  }
  const dbPath = join(dir, 'test.sqlite');
  const db = createDb(dbPath);
  migrate(db, { migrationsFolder });
  const app = await buildApp({
    db,
    contentRoot: root,
    config: testConfig({ DB_PATH: dbPath, ...configOverrides }),
    // Never run the reaper in tests: the boot orphan sweep would destroy
    // other test files' containers under parallel workers.
    startReaper: false,
  });
  return {
    app,
    db,
    cleanup: () => {
      void app.close();
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Create a guest and return its session cookie value for subsequent calls. */
export async function guestCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/guest' });
  if (res.statusCode !== 200) {
    throw new Error(`guest creation failed: ${res.statusCode}`);
  }
  const setCookie = res.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const pair = first?.split(';')[0];
  if (pair === undefined || !pair.startsWith('tq_session=')) {
    throw new Error('guest response set no session cookie');
  }
  return pair;
}
