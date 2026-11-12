import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublicLevelSchema } from '@terminal-quest/shared';
import { guestCookie, makeLevel, makeTestContext } from '../testUtils.js';

const FORBIDDEN = ['check', 'setup', 'solutions', 'hints', 'from_file', 'secret'];

describe('GET /api/levels/:id', () => {
  it('keeps all 27 release levels behind the strict nested DTO whitelist (T9.1)', async () => {
    const root = fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url));
    const ctx = await makeTestContext([], {}, root);
    try {
      const cookie = await guestCookie(ctx.app);
      const release = [...ctx.app.levels.byId.values()].filter((level) => level.world <= 2);
      expect(release).toHaveLength(27);
      for (const level of release) {
        const response = await ctx.app.inject({
          url: `/api/levels/${level.id}`,
          headers: { cookie },
        });
        expect(response.statusCode).toBe(200);
        expect(PublicLevelSchema.parse(response.json())).toEqual(response.json());
        for (const hint of level.hints) expect(response.body).not.toContain(JSON.stringify(hint));
        expect(response.body).not.toContain(level.solutions.reference);
        expect(response.body).not.toContain('{{secret:');
      }
    } finally {
      await ctx.cleanup();
    }
  });
  it('keeps admin policy and seeded answers out of the enabled World 3 DTO (T10.1)', async () => {
    const root = fileURLToPath(new URL('../../../../packages/levels/content/', import.meta.url));
    const ctx = await makeTestContext([], { ENABLE_WORLDS: [1, 2, 3] }, root);
    try {
      const cookie = await guestCookie(ctx.app);
      const response = await ctx.app.inject({
        url: '/api/levels/w3-01-sudo-and-id',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(PublicLevelSchema.parse(response.json())).toEqual(response.json());
      const body = response.json() as Record<string, unknown>;
      for (const key of [...FORBIDDEN, 'sandbox', 'sudo_allow', 'capabilities']) {
        expect(JSON.stringify(body)).not.toContain(`"${key}"`);
      }
      expect(response.body).not.toContain('/opt/tq/secret/access_code');
      expect(response.body).not.toContain('setup/gen.sh');
      for (const hint of ctx.app.levels.byId.get('w3-01-sudo-and-id')!.hints) {
        expect(response.body).not.toContain(JSON.stringify(hint));
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns the public DTO without answers or internals', async () => {
    const ctx = await makeTestContext([makeLevel('first', 1, 1)]);
    try {
      const cookie = await guestCookie(ctx.app);
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/levels/w1-01-first',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        [
          'hintCount',
          'id',
          'kind',
          'objectives',
          'parCommands',
          'story',
          'teaches',
          'title',
          'xp',
        ].sort(),
      );
      const leaked = JSON.stringify(body);
      for (const key of FORBIDDEN) {
        expect(leaked).not.toContain(`"${key}"`);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns 404 for unknown levels and 401 without a session', async () => {
    const ctx = await makeTestContext([makeLevel('first', 1, 1)]);
    try {
      const cookie = await guestCookie(ctx.app);
      expect(
        (
          await ctx.app.inject({
            method: 'GET',
            url: '/api/levels/w9-99-nope',
            headers: { cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/levels/w1-01-first' })).statusCode,
      ).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });
});
