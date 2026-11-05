import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerWebDelivery } from './webDelivery.js';

describe('web delivery startup', () => {
  it('fails clearly when the production web build is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tq-web-test-'));
    const app = Fastify();
    try {
      await expect(registerWebDelivery(app, root)).rejects.toThrow('run pnpm build');
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not serve repository files or JSON requests through the HTML fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tq-web-test-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Game</title>');
    writeFileSync(join(root, 'secret.txt'), 'not a public asset');
    const app = Fastify();
    try {
      await registerWebDelivery(app, root);
      for (const url of ['/secret.txt', '/assets/../secret.txt', '/assets/%2e%2e/secret.txt']) {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain('not a public asset');
      }
      const response = await app.inject({ url: '/map', headers: { accept: 'application/json' } });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
