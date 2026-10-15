import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// T5.2 smoke test: full vertical slice through a live stack (server +
// Docker sandbox + web). The database lives outside the repo so runs never
// dirty the working tree; migrations run before the stack boots.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm db:migrate && pnpm dev',
    url: 'http://localhost:5173',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      DB_PATH: join(tmpdir(), 'tq-e2e.sqlite'),
    } as Record<string, string>,
  },
});
