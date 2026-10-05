import Docker from 'dockerode';
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@terminal-quest/shared';
import type { AppConfig } from '../config.js';

async function isDockerReachable(socketPath: string): Promise<boolean> {
  try {
    const docker = new Docker({ socketPath });
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function registerHealthRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    const docker = await isDockerReachable(config.DOCKER_SOCKET);
    const payload = HealthResponseSchema.parse({ ok: true, docker });
    return reply.send(payload);
  });
}
