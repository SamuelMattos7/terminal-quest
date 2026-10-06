import { z } from 'zod';

// Subset of plan.md §14.1 needed for M0 (server, docker, database).
// Later milestones extend this as they need more vars.
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),
  DB_PATH: z.string().min(1).default('./data/tq.sqlite'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse({
    PORT: env['PORT'],
    PUBLIC_ORIGIN: env['PUBLIC_ORIGIN'],
    DOCKER_SOCKET: env['DOCKER_SOCKET'],
    DB_PATH: env['DB_PATH'],
  });
}
