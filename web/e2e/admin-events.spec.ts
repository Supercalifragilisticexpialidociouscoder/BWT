import { expect, test } from '@playwright/test';
import { istInput, signIn } from './helpers';

/**
 * A platform administrator creates and publishes an event from the workspace for an organization they
 * don't belong to; that organization's organizers can then manage it.
 */
test('admin creates an event for any organization from the overview', async ({ browser }) => {
  const title = `Admin Robotics Clinic ${Date.now().toString(36)}`;
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signIn(admin, 'admin@campusflow.demo');

  await admin.goto('/workspace');
  await expect(admin.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // Reachable from the overview header and from the workspace menu.
  await expect(admin.getByRole('navigation', { name: 'Workspace' }).locator('..').getByRole('link', { name: 'New event' })).toHaveCount(1);
  await admin.getByRole('main').getByRole('link', { name: 'New event' }).click();
  await expect(admin).toHaveURL(/\/workspace\/events\/new$/);
  await expect(admin.getByText('As a platform administrator you can create events for any organization.')).toBeVisible();

  await admin.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await admin.getByRole('combobox', { name: 'Organized by' }).selectOption({ label: 'Robotics Society' });
  await admin.getByRole('combobox', { name: 'Category' }).selectOption('workshop');
  await admin.getByRole('textbox', { name: 'One-line summary' }).fill('A short hands-on clinic created by a platform administrator.');
  await admin.getByRole('textbox', { name: 'Starts', exact: true }).fill(istInput(60 * 24 * 5));
  await admin.getByRole('textbox', { name: 'Ends', exact: true }).fill(istInput(60 * 24 * 5 + 120));
  await admin.getByRole('tab', { name: 'Registration' }).click();
  await admin.getByLabel('Individually').check();
  await admin.getByRole('spinbutton', { name: 'Capacity (people)' }).fill('30');
  await admin.getByRole('textbox', { name: 'Registration deadline' }).fill(istInput(60 * 24 * 4));
  await admin.getByRole('button', { name: 'Create draft' }).click();
  await expect(admin).toHaveURL(/\/workspace\/events\/[a-f0-9]{24}/);
  const eventId = admin.url().match(/events\/([a-f0-9]{24})/)![1]!;
  await admin.getByRole('button', { name: 'Publish' }).click();
  await expect(admin.getByText('Published', { exact: true }).first()).toBeVisible();

  // The event belongs to the Robotics Society: its organizer manages it, other clubs' organizers don't.
  const detail = await (await admin.request.get(`/api/events/${eventId}`)).json();
  expect(detail.organization.name).toBe('Robotics Society');
  const robotics = await browser.newContext();
  const r = await robotics.newPage();
  await signIn(r, 'robotics@campusflow.demo');
  const mine = await (await r.request.get('/api/workspace/events')).json();
  expect(mine.map((e: { id: string }) => e.id)).toContain(eventId);
  const cultural = await browser.newContext();
  const c = await cultural.newPage();
  await signIn(c, 'cultural@campusflow.demo');
  expect((await c.request.put(`/api/events/${eventId}/staff`, { headers: { 'X-Requested-With': 'campusflow' }, data: { staff: [] } })).status()).toBe(403);

  // Participants can find it.
  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto(`/events/${detail.slug}`);
  await expect(a.getByRole('heading', { name: title })).toBeVisible();

  await Promise.all([ctx.close(), robotics.close(), cultural.close(), anon.close()]);
});
