import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { testConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';

describe('GET /healthz', () => {
  it('returns { ok: true, docker: boolean }', async () => {
    const app = Fastify();
    await registerHealthRoute(app, testConfig());

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown;
    expect(body).toEqual({ ok: true, docker: false });
    await app.close();
  });
});
