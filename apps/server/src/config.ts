import { z } from 'zod';
import { SandboxEnvSchema } from '@terminal-quest/shared';

// Subset of plan.md §14.1 needed so far (server, docker, database,
// sandbox lifecycle, worlds). Later milestones extend this as they need more vars.
const ConfigSchema = SandboxEnvSchema.extend({
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
    .trim()
    .regex(/^(?:[1-5](?:\s*,\s*[1-5])*)?$/, 'expected a comma-separated list of worlds 1–5')
    .default('1,2')
    .transform((s) => (s === '' ? [] : [...new Set(s.split(',').map(Number))])),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(env);
}

/** Full config with test-friendly defaults; tests override per case. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT: 3001,
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DOCKER_SOCKET:
      process.platform === 'win32'
        ? 'npipe:////./pipe/tq-test-no-docker'
        : '/nonexistent/docker.sock',
    DB_PATH: ':memory:',
    MAX_CONTAINERS: 20,
    IDLE_TTL_SECONDS: 900,
    MAX_AGE_SECONDS: 3600,
    UNLOCK_ALL: 0,
    ENABLE_WORLDS: [1, 2],
    SANDBOX_RUNTIME: undefined,
    ...overrides,
  };
}
