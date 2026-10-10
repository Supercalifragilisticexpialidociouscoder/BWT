import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const H = { 'X-Requested-With': 'campusflow' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/**
 * Organizer asks for a parent/guardian undertaking and turns on participation approval → participant
 * uploads it from their registration page → organizer approves the document, then participation →
 * participant sees the approval. Registration status and ticket are untouched throughout.
 */
test('document requirement → private upload → review → participation approval', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

  /* ---------------------------------------------------------------- organizer sets up the event */
  const orgCtx = await browser.newContext();
  const org = await orgCtx.newPage();
  await signIn(org, 'head.infin8@campusflow.demo');
  const orgs = await (await org.request.get('/api/organizations')).json();
  const infin8 = orgs.find((o: { name: string }) => o.name === 'Club Infin8');
  const created = await org.request.post('/api/events', {
    headers: H,
    data: {
      title: `E2E Night Build ${stamp}`,
      organization: infin8.id,
      category: 'hackathon',
      summary: 'An end-to-end test event that collects a guardian undertaking.',
      description: '',
      eligibility: '',
      rules: [],
      startsAt: iso(60 * 48),
      endsAt: iso(60 * 60),
      registrationOpensAt: null,
      registrationDeadline: iso(60 * 24),
      mode: 'individual',
      teamSize: { min: 1, max: 1 },
      capacity: 20,
      fee: { amount: 0, currency: 'INR', basis: 'per_registration' },
      paymentInstructions: '',
      requiresApproval: false,
      allowedDepartments: [],
      expectedAttendance: null,
      requiredFacilities: [],
      checkInOpensMinutesBefore: 120,
      schedule: [],
    },
  });
  expect(created.status()).toBe(201);
  const eventId = (await created.json()).id as string;
  expect((await org.request.post(`/api/events/${eventId}/status`, { headers: H, data: { status: 'published' } })).status()).toBe(200);

  await org.goto(`/workspace/events/${eventId}?event=${eventId}&tab=documents`);
  await expect(org.getByRole('heading', { name: 'Participation approval' })).toBeVisible();
  await org.getByRole('button', { name: 'Parent / guardian undertaking' }).click();
  await org.getByRole('textbox', { name: 'What it must contain' }).fill('Signed by your parent or guardian on the institution’s form.');
  await org.getByLabel('Organizers approve each registration’s participation').check();
  await org.getByRole('button', { name: 'Save document settings' }).click();
  await expect(org.getByText('Document settings saved')).toBeVisible();

  /* ---------------------------------------------------------------- participant registers and uploads */
  const pCtx = await browser.newContext();
  const p = await pCtx.newPage();
  const email = `e2e.docs.${stamp}@example.edu`;
  const signup = await p.request.post('/api/auth/signup', {
    headers: H,
    data: { name: 'Docs Tester', email, password: 'e2e-password-123', department: 'CSE', rollNumber: `24E2E${stamp.slice(-5).toUpperCase()}` },
  });
  expect(signup.status()).toBe(201);
  const reg = await p.request.post(`/api/events/${eventId}/register`, { headers: H, data: {} });
  expect(reg.status()).toBe(201);
  const regId = (await reg.json()).id as string;

  await p.goto(`/me/registrations/${regId}`);
  await expect(p.getByRole('heading', { name: 'Documents & participation approval' })).toBeVisible();
  await expect(p.getByText('1 required document is still to be uploaded.')).toBeVisible();
  await p.getByLabel('Parent / guardian undertaking file for You').setInputFiles({ name: 'parent-guardian-undertaking-signed-scan-final-version-for-the-overnight-event.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(p.getByText('Document uploaded')).toBeVisible();
  await expect(p.getByText('parent-guardian-undertaking-signed-scan-final-version-for-the-overnight-event.pdf')).toBeVisible();
  await expect(p.getByText('Everything required is in. The organizers will review it.')).toBeVisible();
  // Long file names truncate instead of widening the page on phones.
  await p.setViewportSize({ width: 390, height: 844 });
  expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await p.setViewportSize({ width: 1280, height: 900 });

  /* ---------------------------------------------------------------- organizer reviews and approves */
  await org.goto(`/workspace/registrations?event=${eventId}&participation=awaiting_review&reg=${regId}`);
  const drawer = org.getByRole('dialog');
  await drawer.getByRole('button', { name: /^Approve Parent \/ guardian undertaking for Docs Tester/ }).click();
  await expect(org.getByText('Document approved')).toBeVisible();
  await drawer.getByRole('button', { name: 'Approve participation' }).click();
  await expect(drawer.getByText(/^Approved by Aarav Reddy/)).toBeVisible();

  /* ---------------------------------------------------------------- participant sees the outcome */
  await p.reload();
  await expect(p.getByText('Participation is approved.')).toBeVisible();
  await expect(p.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  // The file is private: another signed-in person gets nothing.
  const docs = await (await p.request.get(`/api/registrations/${regId}/documents`)).json();
  const docId = docs.slots[0].document.id as string;
  expect((await p.request.get(`/api/documents/${docId}/file`)).status()).toBe(200);
  const stranger = await browser.newContext();
  const s = await stranger.newPage();
  await signIn(s, 'student@campusflow.demo');
  expect((await s.request.get(`/api/documents/${docId}/file`)).status()).toBe(404);

  await Promise.all([orgCtx.close(), pCtx.close(), stranger.close()]);
});
