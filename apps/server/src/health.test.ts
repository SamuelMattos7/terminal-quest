import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerHealthRoute } from './routes/health.js';

describe('GET /healthz', () => {
  it('returns { ok: true, docker: boolean }', async () => {
    const app = Fastify();
    await registerHealthRoute(app, {
      PORT: 3001,
      PUBLIC_ORIGIN: 'http://localhost:5173',
      DOCKER_SOCKET: '/nonexistent/docker.sock',
      DB_PATH: ':memory:',
      MAX_CONTAINERS: 20,
      IDLE_TTL_SECONDS: 900,
      MAX_AGE_SECONDS: 3600,
    });

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown;
    expect(body).toEqual({ ok: true, docker: false });
    await app.close();
  });
});
