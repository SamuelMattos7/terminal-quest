import { expect, test } from '@playwright/test';
import { waitForSandbox } from './readiness.js';

// M5 gate (T5.2): a new visitor starts playing, solves w1-01 in the real
// terminal, sees the completion modal, and finds w1-02 unlocked on the map.
test('smoke: start, solve w1-01, unlock w1-02', async ({ page }) => {
  await waitForSandbox(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page).toHaveURL(/\/map/, { timeout: 30_000 });

  let completion: unknown;
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/ws/sessions/')) return;
    socket.on('framereceived', ({ payload }) => {
      const frame: unknown = JSON.parse(payload.toString());
      if (frame && typeof frame === 'object' && 't' in frame && frame.t === 'level_complete') {
        completion = frame;
      }
    });
  });

  await page.getByRole('link', { name: /First Words/ }).click();
  await expect(page).toHaveURL(/\/play\/w1-01-first-words/, { timeout: 30_000 });
  // The terminal renders after level fetch + session start (container
  // create) + first session_state: generous budget for CI tail latency.
  await expect(page.getByTestId('terminal-container')).toBeVisible({ timeout: 30_000 });
  // The socket must be live before keystrokes, or they are dropped.
  await expect(page.getByText('Connected')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('terminal-container').click();
  await page.keyboard.type('echo hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('objective-said-hello')).toContainText('done', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('objective-said-name')).toContainText('done', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('complete-modal')).toBeVisible({ timeout: 30_000 });
  expect(completion).toMatchObject({ result: { unlocked: ['w1-02-where-am-i'] } });
  await expect(page.getByRole('button', { name: 'Next level', exact: true })).toBeVisible();

  await page.getByTestId('complete-back').click();
  await expect(page).toHaveURL(/\/map/, { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Where Am I/ })).toBeVisible({ timeout: 30_000 });
});
