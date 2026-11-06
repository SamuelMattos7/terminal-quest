import { expect, test } from '@playwright/test';
import { waitForSandbox } from './readiness.js';

test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 420 } });

test('mobile keys follow the visible viewport and completion keeps keyboard focus in the dialog', async ({
  page,
}) => {
  await waitForSandbox(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start playing' }).click();
  await page.getByRole('link', { name: /First Words/ }).click();
  await expect(page.getByText('Connected')).toBeVisible({ timeout: 30_000 });

  const terminal = page.getByTestId('terminal-container');
  const input = terminal.locator('textarea');
  const toolbar = page.getByRole('toolbar');
  const ctrl = toolbar.getByRole('button', { name: 'Ctrl', exact: true });
  await expect(toolbar).toBeVisible();
  await terminal.tap();
  await expect(input).toBeFocused();

  // Chromium touch emulation has no OS keyboard. Simulate its viewport resize and pan.
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: window.innerHeight - 180 },
      offsetTop: { configurable: true, value: 0 },
    });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(toolbar).toHaveCSS('bottom', '180px');
  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Object.defineProperty(viewport, 'offsetTop', { value: 30 });
    viewport.dispatchEvent(new Event('scroll'));
  });
  await expect(toolbar).toHaveCSS('bottom', '150px');
  await ctrl.tap();
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toBeFocused();
  await ctrl.tap();

  await page.evaluate(() => {
    const viewport = window.visualViewport!;
    Reflect.deleteProperty(viewport, 'height');
    Reflect.deleteProperty(viewport, 'offsetTop');
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect(toolbar).toHaveCSS('bottom', '0px');

  await page.setViewportSize({ width: 390, height: 300 });
  await expect(input).toBeFocused();
  await page.keyboard.type('echo hello');
  await page.keyboard.press('Enter');
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: /Level complete/i });
  const heading = dialog.getByRole('heading', { name: /Level complete/i });
  await expect(heading).toBeFocused({ timeout: 30_000 });
  await expect(dialog).toHaveJSProperty('scrollTop', 0);
  await input.evaluate((element) => element.focus());
  await expect(heading).toBeFocused();

  const back = dialog.getByTestId('complete-back');
  await page.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();
  await expect(back).toBeInViewport();
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await expect(dialog.getByTestId('complete-next')).toBeFocused();
  await page.keyboard.press('Tab');
  const replay = dialog.getByTestId('complete-replay');
  await expect(replay).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(input).toBeFocused({ timeout: 30_000 });
  await expect(page.getByText('Connected')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Leave level' }).click();
  await expect(page).toHaveURL(/\/map$/);
});
