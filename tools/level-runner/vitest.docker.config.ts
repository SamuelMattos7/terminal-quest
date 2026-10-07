import { defineConfig } from 'vitest/config';

// Docker integration suite for `pnpm test:docker`. Requires a running
// Docker daemon with the `tq-base` image built (`pnpm images:build`).
export default defineConfig({
  test: {
    include: ['src/**/*.docker.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
