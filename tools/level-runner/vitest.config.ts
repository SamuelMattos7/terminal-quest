import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Docker integration tests run only via `pnpm test:docker` (T2.6), so
    // plain `pnpm test` stays green on machines without Docker.
    exclude: ['src/**/*.docker.test.ts', 'node_modules', 'dist'],
  },
});
