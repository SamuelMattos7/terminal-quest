import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectOptions, DockerProvider } from './dockerProvider.js';
import { SessionManager, CapacityError } from './sessionManager.js';
import type { SandboxSpec } from './provider.js';
import { attempts } from '../db/schema.js';
import { guestCookie, makeDockerTestContext } from '../testUtils.js';

afterEach(() => vi.restoreAllMocks());

const docker = new Docker(connectOptions(process.env['DOCKER_SOCKET']));

function spec(): SandboxSpec {
  return {
    attemptId: `a05-${randomUUID()}`,
    userId: 'a05-user',
    levelId: 'a05-level',
    image: 'tq-base',
    profile: 'basic',
    network: 'none',
    sidecars: [],
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/home/player',
    env: {},
  };
}

describe('real-container teardown recovery (A05)', () => {
  it.each([false, true])(
    'removes a failed-start container (initial cleanup failure: %s)',
    async (failCleanup) => {
      let container: Docker.Container | undefined;
      const client = {
        createContainer: async (options: Docker.ContainerCreateOptions) => {
          container = await docker.createContainer(options);
          vi.spyOn(container, 'start').mockRejectedValueOnce(new Error('injected start failure'));
          return container;
        },
        getContainer: (id: string) => docker.getContainer(id),
        listContainers: docker.listContainers.bind(docker),
      };
      const provider = new DockerProvider({ client });
      const manager = new SessionManager({
        provider,
        maxContainers: 1,
        idleTtlMs: 100,
        maxAgeMs: 200,
      });
      if (failCleanup)
        vi.spyOn(provider, 'destroy').mockRejectedValueOnce(new Error('injected cleanup failure'));
      try {
        await expect(manager.create(spec())).rejects.toThrow('injected start failure');
        if (container === undefined) throw new Error('container not created');
        if (failCleanup) {
          expect(manager.size).toBe(1);
          expect((await container.inspect()).State.Running).toBe(false);
          await expect(manager.create(spec())).rejects.toThrow(CapacityError);
          await manager.sweepOnce();
        }
        expect(manager.size).toBe(0);
        await expect(container.inspect()).rejects.toMatchObject({ statusCode: 404 });
      } finally {
        await manager.closeAll();
        if (container !== undefined)
          await docker
            .getContainer(container.id)
            .remove({ force: true, v: true })
            .catch((err: unknown) => {
              if (!(
                typeof err === 'object' &&
                err !== null &&
                'statusCode' in err &&
                err.statusCode === 404
              ))
                throw err;
            });
      }
    },
    60_000,
  );

  it.each(['watcher', 'expiry'] as const)(
    'retries failed %s teardown and removes the real sandbox',
    async (stage) => {
      const ctx = await makeDockerTestContext(undefined, { MAX_CONTAINERS: 1 });
      const { app } = ctx;
      const create = vi.spyOn(app.provider, 'create');
      const destroy = vi.spyOn(app.provider, 'destroy');
      const open = vi.spyOn(app.provider, 'openShell');
      const watchFile = app.provider.watchFile.bind(app.provider);
      const stops: ReturnType<typeof vi.spyOn>[] = [];
      vi.spyOn(app.provider, 'watchFile').mockImplementation(
        async (handle, path, onLine, onError) => {
          if (stage === 'watcher' && path === '/run/tq/cmdlog')
            throw new Error('injected watcher failure');
          const watcher = await watchFile(handle, path, onLine, onError);
          stops.push(vi.spyOn(watcher, 'stop'));
          return watcher;
        },
      );
      const cookie = await guestCookie(app);
      const start = () =>
        app.inject({ method: 'POST', url: '/api/levels/w1-01-first/start', headers: { cookie } });
      try {
        if (stage === 'watcher')
          destroy.mockRejectedValueOnce(new Error('injected Docker failure'));
        expect((await start()).statusCode).toBe(stage === 'watcher' ? 500 : 200);
        const handle = await create.mock.results[0]!.value;
        const shell = await open.mock.results[0]!.value;
        const close = vi.spyOn(shell, 'close');
        if (stage === 'expiry') {
          destroy.mockRejectedValueOnce(new Error('injected Docker failure'));
          const live = [...app.live.values()][0]!;
          await expect(
            app.manager.sweepOnce(live.session.createdAt + app.config.MAX_AGE_SECONDS * 1000),
          ).rejects.toThrow();
          expect(close).toHaveBeenCalledTimes(1);
        }
        expect(app.live.size).toBe(0);
        expect(app.manager.size).toBe(1);
        expect(ctx.db.select().from(attempts).get()?.status).toBe(
          stage === 'watcher' ? 'abandoned' : 'expired',
        );
        for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
        expect((await docker.getContainer(handle.id).inspect()).State.Running).toBe(true);
        expect((await start()).statusCode).toBe(429);
        await app.manager.sweepOnce();
        expect(app.manager.size).toBe(0);
        await expect(docker.getContainer(handle.id).inspect()).rejects.toMatchObject({
          statusCode: 404,
        });
        vi.mocked(app.provider.watchFile).mockRestore();
        expect((await start()).statusCode).toBe(200);
      } finally {
        await ctx.cleanup();
      }
    },
    60_000,
  );
});
