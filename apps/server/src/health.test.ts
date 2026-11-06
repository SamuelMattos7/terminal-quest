import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDb, createDb } from './db/client.js';

const { connect, ping } = vi.hoisted(() => ({ connect: vi.fn(), ping: vi.fn() }));

vi.mock('dockerode', () => ({
  default: class {
    constructor(options: unknown) {
      connect(options);
    }
    ping = ping;
  },
}));

describe('GET /healthz', () => {
  it.each([
    {
      socketPath: undefined,
      expected: process.platform === 'win32' ? {} : { socketPath: '/var/run/docker.sock' },
      docker: false,
    },
    {
      socketPath: 'npipe:////./pipe/tq-override',
      expected: { socketPath: '//./pipe/tq-override' },
      docker: true,
    },
  ])(
    'uses the gameplay socket and reports Docker readiness as $docker',
    async ({ socketPath, expected, docker }) => {
      connect.mockClear();
      ping.mockReset();
      if (docker) {
        ping.mockResolvedValue('OK');
      } else {
        ping.mockRejectedValue(new Error('Docker unavailable'));
      }

      const db = createDb(':memory:');
      const app = await buildApp({
        db,
        config: loadConfig({}),
        ...(socketPath === undefined ? {} : { socketPath }),
        startReaper: false,
      });
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, docker });
        expect(ping).toHaveBeenCalledOnce();
        expect(connect.mock.calls).toEqual([[expected], [expected]]);
      } finally {
        await app.close();
        closeDb(db);
      }
    },
  );
});
