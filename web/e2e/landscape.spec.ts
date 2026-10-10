import { expect, test } from '@playwright/test';

test('the event landscape is operable from the keyboard and opens the selected event', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: /^Events from/ }).getByRole('button').first()).toBeVisible();
  const stage = page.getByRole('application', { name: /Event landscape/ });
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  const panel = page.getByRole('region', { name: 'Selected event' }).first();
  await expect(panel).toBeVisible();
  const title = (await panel.getByRole('heading', { level: 2 }).textContent())!.trim();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('heading', { level: 2 })).not.toHaveText(title);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Selected event' })).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/events\/[a-z0-9-]+$/);
});

test('without WebGL the 2D landscape, rail and directory still work', async ({ page }) => {
  await page.goto('/?webgl=off');
  await expect(page.locator('canvas')).toHaveCount(0);
  const marker = page.getByRole('group', { name: /^Events from/ }).getByRole('button').first();
  await marker.click();
  await expect(page.getByRole('region', { name: 'Selected event' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Event directory' }).click();
  await expect(page.getByText(/upcoming events?/).first()).toBeVisible();
});

for (const width of [390, 768, 1024]) {
  test(`no horizontal overflow on key pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/', '/events', '/login', '/signup']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}
