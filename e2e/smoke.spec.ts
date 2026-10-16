import { expect, test } from '@playwright/test';

// M5 gate (T5.2): a new visitor starts playing, solves w1-01 in the real
// terminal, sees the completion modal, and finds w1-02 unlocked on the map.
test('smoke: start, solve w1-01, unlock w1-02', async ({ page }) => {
  await page.goto('/');
  // The webServer URL only proves vite is up; the proxied API server (tsx)
  // can lag behind, and an early guest POST proxy-500s. Gate on /healthz
  // (which also proves Docker is reachable) before clicking anything.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/healthz').catch(() => undefined);
        return res?.status();
      },
      { timeout: 90_000 },
    )
    .toBe(200);
  await page.getByRole('button', { name: 'Start playing' }).click();
  await expect(page).toHaveURL(/\/map/);

  await page.getByRole('link', { name: /First Words/ }).click();
  await expect(page).toHaveURL(/\/play\/w1-01-first-words/);
  await expect(page.getByTestId('terminal-container')).toBeVisible();
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

  await page.getByTestId('complete-back').click();
  await expect(page).toHaveURL(/\/map/);
  await expect(page.getByRole('link', { name: /Where Am I/ })).toBeVisible();
});
