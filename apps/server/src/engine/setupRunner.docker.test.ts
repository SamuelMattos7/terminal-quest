import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLevels } from './levelLoader.js';
import { compileSetup } from './setupCompiler.js';
import { runSetup } from './setupRunner.js';
import { DockerProvider } from '../sandbox/dockerProvider.js';
import type { SandboxHandle, SandboxSpec } from '../sandbox/provider.js';

// T2.2 acceptance (requires Docker + `tq-base`): the sample level's seeded
// generator yields different answers per seed, /run/tq/cmdlog is writable
// by player, and /opt/tq/secret is not readable by player.

function repoContentRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(resolve(here, '..', '..', '..', '..'), 'packages', 'levels', 'content');
}

function specFor(attemptId: string): SandboxSpec {
  return {
    attemptId,
    userId: 't22-user',
    levelId: 'w1-02-where-am-i',
    image: 'tq-base',
    profile: 'basic',
    network: 'none',
    sidecars: [],
    resources: { memoryMb: 256, cpus: 0.5, pids: 128 },
    startCwd: '/home/player',
    env: {},
  };
}

describe('runSetup with the seeded sample level', () => {
  const provider = new DockerProvider({ socketPath: process.env['DOCKER_SOCKET'] });
  const handles: SandboxHandle[] = [];

  afterAll(async () => {
    for (const h of handles) {
      await provider.destroy(h);
    }
  }, 60_000);

  async function setupWithSeed(seed: number): Promise<{ handle: SandboxHandle; word: string }> {
    const loaded = loadLevels(repoContentRoot());
    const level = loaded.byId.get('w1-02-where-am-i');
    const levelDir = loaded.levelDirs.get('w1-02-where-am-i');
    if (level === undefined || levelDir === undefined) {
      throw new Error('sample level w1-02-where-am-i missing from content tree');
    }
    const handle = await provider.create(specFor(`t22-seed-${seed}`));
    handles.push(handle);
    const compiled = compileSetup(level, levelDir, seed);
    const result = await runSetup(provider, handle, compiled, seed);
    expect(result.code).toBe(0);
    const secret = await provider.exec(handle, ['cat', '/opt/tq/secret/welcome_word'], {
      user: 'root',
    });
    expect(secret.code).toBe(0);
    return { handle, word: secret.stdout.trim() };
  }

  it('yields different seeded answers that match visible files', async () => {
    const first = await setupWithSeed(1);
    const second = await setupWithSeed(2);
    expect(first.word.length).toBeGreaterThan(0);
    expect(second.word).not.toBe(first.word);
    for (const { handle, word } of [first, second]) {
      const listed = await provider.exec(handle, ['ls', `/home/player/welcome-${word}.txt`], {
        user: 'player',
      });
      expect(listed.code).toBe(0);
    }
  }, 120_000);

  it('/run/tq/cmdlog is writable and /opt/tq/secret is hidden from player', async () => {
    const { handle } = await setupWithSeed(3);
    const append = await provider.exec(handle, ['bash', '-c', 'echo x >> /run/tq/cmdlog'], {
      user: 'player',
    });
    expect(append.code).toBe(0);
    const peek = await provider.exec(handle, ['cat', '/opt/tq/secret/welcome_word'], {
      user: 'player',
    });
    expect(peek.code).not.toBe(0);
  }, 120_000);
});
