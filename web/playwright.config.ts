import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real UI against the real API and database.
 * Prerequisites: MongoDB running and `npm run seed` (the tests use the demo accounts).
 * Uses the locally installed Google Chrome (no browser download); each run gets a fresh profile.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm run dev -w server', cwd: '..', port: 4000, reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev -w web', cwd: '..', port: 5173, reuseExistingServer: true, timeout: 60_000 },
  ],
});
