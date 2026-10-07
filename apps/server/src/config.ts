import { z } from 'zod';

// Subset of plan.md §14.1 needed so far (server, docker, database,
// sandbox lifecycle, worlds). Later milestones extend this as they need more vars.
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),
  DB_PATH: z.string().min(1).default('./data/tq.sqlite'),
  MAX_CONTAINERS: z.coerce.number().int().positive().default(20),
  IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  UNLOCK_ALL: z.coerce.number().int().min(0).max(1).default(0),
  ENABLE_WORLDS: z
    .string()
    .min(1)
    .default('1,2')
    .transform((s) =>
      s
        .split(',')
        .map((w) => Number(w.trim()))
        .filter((w) => Number.isInteger(w) && w >= 1),
    ),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse({
    PORT: env['PORT'],
    PUBLIC_ORIGIN: env['PUBLIC_ORIGIN'],
    DOCKER_SOCKET: env['DOCKER_SOCKET'],
    DB_PATH: env['DB_PATH'],
    MAX_CONTAINERS: env['MAX_CONTAINERS'],
    IDLE_TTL_SECONDS: env['IDLE_TTL_SECONDS'],
    MAX_AGE_SECONDS: env['MAX_AGE_SECONDS'],
    UNLOCK_ALL: env['UNLOCK_ALL'],
    ENABLE_WORLDS: env['ENABLE_WORLDS'],
  });
}

/** Full config with test-friendly defaults; tests override per case. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT: 3001,
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DOCKER_SOCKET: '/nonexistent/docker.sock',
    DB_PATH: ':memory:',
    MAX_CONTAINERS: 20,
    IDLE_TTL_SECONDS: 900,
    MAX_AGE_SECONDS: 3600,
    UNLOCK_ALL: 0,
    ENABLE_WORLDS: [1, 2],
    ...overrides,
  };
}
