import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Regression: signing out used to end the server session but leave the signed-in UI (name, tickets,
// workspace) on screen, because the client dropped the session query without notifying the page.

const signOutButton = (page: Page) => page.getByRole('button', { name: 'Sign out' }).filter({ visible: true });
const signInLink = (page: Page) => page.getByRole('link', { name: 'Sign in' }).filter({ visible: true });

async function expectSignedOutEverywhere(page: Page) {
  expect((await page.context().cookies()).some((c) => c.name === 'cf_sid')).toBe(false);
  expect((await page.request.get('/api/me/registrations')).status()).toBe(401);
  await page.reload();
  await expect(signInLink(page)).toBeVisible();
}

test('participant: sign out from the header leaves no signed-in state behind', async ({ page }) => {
  await signIn(page, 'student@campusflow.demo');
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();

  await signOutButton(page).click();

  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByText('Signed out', { exact: true })).toBeVisible();
  await expect(signInLink(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'My events' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your events' })).toHaveCount(0);

  await expectSignedOutEverywhere(page);
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login\?next=%2Fme$/);
});

test('organizer: sign out from the workspace sidebar returns to the public site', async ({ page }) => {
  await signIn(page, 'head.infin8@campusflow.demo');
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await signOutButton(page).click();

  await expect(page).toHaveURL(/localhost:5173\/$/);
  await expect(page.getByRole('link', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expectSignedOutEverywhere(page);
  await page.goto('/workspace/registrations');
  await expect(page).toHaveURL(/\/login\?next=%2Fworkspace%2Fregistrations$/);
});

test('signing out in one tab signs the other open tabs out', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, 'student@campusflow.demo');
  const second = await context.newPage();
  await second.goto('/me');
  await expect(second.getByRole('heading', { name: 'Your events' })).toBeVisible();

  await first.goto('/events');
  await signOutButton(first).click();
  await expect(first).toHaveURL(/localhost:5173\/$/);

  // The other tab drops the private page without being touched.
  await expect(second.getByRole('heading', { name: 'Your events' })).toHaveCount(0);
  await expect(second).not.toHaveURL(/\/me$/);
});

test('a session ended elsewhere is noticed on the next request', async ({ page }) => {
  await signIn(page, 'student@campusflow.demo');
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();

  // Same cookie, signed out by another client that can't notify this tab (another browser window, an API call).
  await page.request.post('/api/auth/logout', { headers: { 'X-Requested-With': 'campusflow' } });

  await page.locator('a[href^="/me/tickets/"]').first().click();
  await expect(page).toHaveURL(/\/login\?next=%2Fme%2Ftickets%2F/);
});
