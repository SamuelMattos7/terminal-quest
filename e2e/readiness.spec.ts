import { expect, test } from '@playwright/test';
import { isSandboxReady } from './readiness.js';

test('requires a successful health response that confirms Docker is ready', async () => {
  expect(await isSandboxReady(undefined)).toBe(false);
  expect(
    await isSandboxReady({ ok: () => false, json: async () => ({ ok: true, docker: true }) }),
  ).toBe(false);
  expect(
    await isSandboxReady({
      ok: () => true,
      json: async () => {
        throw new SyntaxError('Vite returned HTML');
      },
    }),
  ).toBe(false);
  expect(await isSandboxReady({ ok: () => true, json: async () => ({ ok: true }) })).toBe(false);
  expect(
    await isSandboxReady({ ok: () => true, json: async () => ({ ok: true, docker: false }) }),
  ).toBe(false);
  expect(
    await isSandboxReady({ ok: () => true, json: async () => ({ ok: true, docker: true }) }),
  ).toBe(true);
});
