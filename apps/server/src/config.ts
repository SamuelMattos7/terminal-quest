import { z } from 'zod';

// Subset of plan.md §14.1 needed for T0.1. Full config lands with later milestones.
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  DOCKER_SOCKET: z.string().min(1).default('/var/run/docker.sock'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse({
    PORT: env['PORT'],
    PUBLIC_ORIGIN: env['PUBLIC_ORIGIN'],
    DOCKER_SOCKET: env['DOCKER_SOCKET'],
  });
}
