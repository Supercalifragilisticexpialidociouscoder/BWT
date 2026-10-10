// Captures presentation screenshots from a running CampusFlow (npm run dev + npm run demo:reset).
// Usage: npm run demo:shots -- [output-folder]
// Note: it performs one real check-in (for the scanner shot); run `npm run demo:reset` afterwards.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT = path.resolve(process.argv[2] ?? 'demo-screenshots');
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const PASSWORD = 'campusflow-demo';
const H = { 'X-Requested-With': 'campusflow' };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  // Software WebGL so the 3D landscape renders without a GPU.
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

const desktop = { width: 1600, height: 900 };
const phone = { width: 390, height: 844 };

async function session(viewport, email, scale = 2) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn('page error:', e.message));
  if (email) {
    const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, headers: H });
    if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
  }
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('saved', name);
}

async function waitForScene(page) {
  // The 2D layer fades out once the WebGL scene has rendered its first frame.
  await page
    .waitForFunction(() => {
      const svg = document.querySelector('svg[role="presentation"]');
      return Boolean(document.querySelector('canvas')) && svg && getComputedStyle(svg.parentElement).opacity === '0';
    }, null, { timeout: 20_000 })
    .catch(() => console.warn('3D scene not ready — capturing the 2D landscape'));
  await page.waitForTimeout(2500); // let the camera settle
}

const api = async (page, url) => (await page.request.get(`${BASE}${url}`)).json();

// ---------------------------------------------------------------- public
{
  const { context, page } = await session(desktop);
  await page.goto(`${BASE}/`);
  await waitForScene(page);
  await shot(page, '01-home');

  await page.getByRole('application', { name: /Event landscape/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2800);
  await shot(page, '02-home-selected');

  await page.goto(`${BASE}/events`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, '03-directory');

  await page.goto(`${BASE}/events/build-your-first-web-app`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, '04-event-page');
  await context.close();
}

// ---------------------------------------------------------------- organizer
const hack = await (async () => {
  const { context, page } = await session(desktop, 'head.infin8@campusflow.demo');
  const event = await api(page, '/api/events/infin8-hack-day');
  const pending = await api(page, `/api/events/${event.id}/registrations?paymentStage=awaiting_verification`);
  const regId = pending.items[0]?.id ?? (await api(page, `/api/events/${event.id}/registrations`)).items[0].id;

  await page.goto(`${BASE}/workspace/registrations?event=${event.id}&reg=${regId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await shot(page, '06-registration-drawer');

  await page.goto(`${BASE}/workspace/calendar`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, '07-calendar');

  await page.goto(`${BASE}/live/${event.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await shot(page, '08-live-dashboard');
  await context.close();
  return event;
})();

{
  const { context, page } = await session(desktop, 'faculty.cse@campusflow.demo');
  await page.goto(`${BASE}/workspace`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await shot(page, '05-overview');
  await context.close();
}

// ---------------------------------------------------------------- phone: ticket and scanner
{
  const { context, page } = await session(phone, 'student@campusflow.demo', 3);
  const [ticket] = await api(page, '/api/me/tickets');
  await page.goto(`${BASE}/me/tickets/${ticket.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await shot(page, '09-ticket-phone');
  await context.close();
}
{
  const { context, page } = await session(phone, 'volunteer@campusflow.demo', 3);
  const candidates = await api(page, `/api/events/${hack.id}/lookup?q=24DM`);
  const target = candidates.find((t) => t.status === 'active' && t.registration.status === 'confirmed');
  await page.goto(`${BASE}/live/${hack.id}/scan`);
  await page.waitForLoadState('networkidle');
  await shot(page, '10-scanner-intro-phone');
  if (target) {
    await page.getByRole('tab', { name: 'Manual lookup' }).click();
    await page.getByPlaceholder(/Ticket code/).fill(target.shortCode);
    await page.getByRole('button', { name: 'Check in' }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.waitForTimeout(400);
    await shot(page, '11-scanner-valid-phone');
  }
  await context.close();
}

await browser.close();
console.log(`\nScreenshots in ${OUT}`);
