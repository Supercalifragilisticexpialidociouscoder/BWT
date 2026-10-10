import { expect, test } from '@playwright/test';
import { istInput, signIn } from './helpers';

test('create → publish → register → pay → verify → ticket → check-in → live update → export', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E Build Sprint ${stamp}`;
  const participantEmail = `e2e.${stamp}@example.edu`;

  /* ---------------------------------------------------------------- organizer creates and publishes */
  const orgCtx = await browser.newContext();
  const org = await orgCtx.newPage();
  await signIn(org, 'head.infin8@campusflow.demo');
  await org.goto('/workspace/events/new');
  await org.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await org.getByRole('combobox', { name: 'Category' }).selectOption('hackathon');
  await org.getByRole('textbox', { name: 'One-line summary' }).fill('An end-to-end test event created by Playwright.');
  // Starts in 30 minutes so the check-in window (opens 2 h before) is already open.
  await org.getByRole('textbox', { name: 'Starts', exact: true }).fill(istInput(30));
  await org.getByRole('textbox', { name: 'Ends', exact: true }).fill(istInput(240));
  await org.getByRole('tab', { name: 'Registration' }).click();
  await org.getByLabel('Individually').check();
  await org.getByRole('spinbutton', { name: 'Capacity (people)' }).fill('20');
  await org.getByRole('textbox', { name: 'Registration deadline' }).fill(istInput(20));
  await org.getByRole('spinbutton', { name: 'Fee (₹)' }).fill('50');
  await org.getByRole('textbox', { name: 'Payment instructions' }).fill('Pay ₹50 by UPI to test@demo and submit the UTR.');
  await org.getByRole('button', { name: 'Create draft' }).click();
  await expect(org).toHaveURL(/\/workspace\/events\/[a-f0-9]{24}/);
  const eventId = org.url().match(/events\/([a-f0-9]{24})/)![1]!;
  await org.getByRole('button', { name: 'Publish' }).click();
  await expect(org.getByText('Published', { exact: true }).first()).toBeVisible();

  /* ---------------------------------------------------------------- participant signs up and registers */
  const userCtx = await browser.newContext();
  const user = await userCtx.newPage();
  await user.goto('/signup');
  await user.getByLabel('Full name').fill('Ee Tee Participant');
  await user.getByLabel('College email').fill(participantEmail);
  await user.getByLabel('Password').fill('a-long-test-password');
  await user.getByLabel('Department').selectOption('CSE');
  await user.getByLabel('Roll number').fill(`E2E${stamp}`.toUpperCase().slice(0, 12));
  await user.getByRole('button', { name: 'Create account' }).click();
  await expect(user).toHaveURL(/\/me$/);

  await user.goto(`/events?q=${encodeURIComponent(title)}`);
  await user.getByRole('link', { name: title }).click();
  await expect(user.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await user.getByRole('link', { name: 'Register', exact: true }).first().click();
  await user.getByRole('button', { name: 'Confirm registration' }).click();
  await expect(user).toHaveURL(/\/me\/registrations\/[a-f0-9]{24}/);
  await expect(user.getByText('Payment reference not yet submitted').first()).toBeVisible();

  await user.getByLabel('Transaction reference (UTR)').fill(`5${Date.now().toString().slice(-11)}`);
  await user.getByRole('button', { name: 'Submit reference' }).click();
  await expect(user.getByText('Awaiting verification').first()).toBeVisible();

  /* ---------------------------------------------------------------- organizer verifies the payment */
  await org.goto(`/workspace/payments?event=${eventId}`);
  const row = org.getByRole('row', { name: /Ee Tee Participant/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Verify' }).click();
  await expect(org.getByText(/verified/i).first()).toBeVisible();

  /* ---------------------------------------------------------------- ticket issued */
  await user.reload();
  await expect(user.getByText('Confirmed').first()).toBeVisible();
  await user.getByRole('link', { name: 'Show QR ticket' }).click();
  await expect(user.getByRole('img', { name: 'Ticket QR code' })).toBeVisible();
  const shortCode = (await user.locator('p.font-mono').filter({ hasText: /^[A-Z2-9]{6}$/ }).first().textContent())!.trim();
  expect(shortCode).toMatch(/^[A-Z2-9]{6}$/);

  /* ---------------------------------------------------------------- live dashboard open in a second tab */
  const dash = await orgCtx.newPage();
  await dash.goto(`/live/${eventId}`);
  const counter = dash.locator('[aria-live="polite"][aria-atomic="true"] span').first();
  await expect(counter).toHaveText('0');
  await expect(dash.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();

  /* ---------------------------------------------------------------- check-in at the door */
  await org.goto(`/live/${eventId}/scan`);
  await expect(org.getByRole('button', { name: 'Start camera' })).toBeVisible(); // no permission requested yet
  await org.getByRole('tab', { name: 'Manual lookup' }).click();
  await org.getByPlaceholder(/Ticket code/).fill(shortCode);
  await org.getByRole('button', { name: 'Check in' }).click();
  await expect(org.getByRole('alertdialog')).toContainText('Checked in');
  await expect(org.getByRole('alertdialog')).toContainText('Ee Tee Participant');

  // The other tab updates over the socket — no reload.
  await expect(counter).toHaveText('1');
  await expect(dash.getByText('Ee Tee Participant').first()).toBeVisible();

  // A second admission of the same ticket is refused.
  await expect(org.getByRole('alertdialog')).toBeHidden({ timeout: 8_000 }); // valid results close themselves
  await org.getByRole('button', { name: 'Verify' }).click();
  await expect(org.getByRole('alertdialog')).toContainText('Already checked in');
  await expect(counter).toHaveText('1');

  /* ---------------------------------------------------------------- participant's ticket reflects entry; export */
  await user.reload();
  await expect(user.getByText('Checked in').first()).toBeVisible();
  const csv = await org.request.get(`/api/events/${eventId}/exports/attendance.csv`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Ee Tee Participant');

  // Clean up the test event so the demo directory stays tidy (cancel keeps the audit trail).
  await org.request.post(`/api/events/${eventId}/status`, { data: { status: 'cancelled' }, headers: { 'X-Requested-With': 'campusflow' } });
  await orgCtx.close();
  await userCtx.close();
});
