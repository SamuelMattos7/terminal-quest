import Docker from 'dockerode';
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@terminal-quest/shared';
import { connectOptions } from '../sandbox/dockerProvider.js';

async function isDockerReachable(socketPath: string): Promise<boolean> {
  try {
    const docker = new Docker(connectOptions(socketPath));
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

export async function registerHealthRoute(app: FastifyInstance, socketPath: string): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    const docker = await isDockerReachable(socketPath);
    const payload = HealthResponseSchema.parse({ ok: true, docker });
    return reply.send(payload);
  });
}
