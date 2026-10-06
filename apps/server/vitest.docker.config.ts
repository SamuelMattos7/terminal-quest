import { defineConfig } from 'vitest/config';

// Docker integration suite for `pnpm test:docker` (T1.2). Requires a
// running Docker daemon with the `tq-base` image built (`pnpm images:build`).
export default defineConfig({
  test: {
    include: ['src/**/*.docker.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
