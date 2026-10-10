import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'campusflow-demo';

/** `YYYY-MM-DDTHH:mm` in Asia/Kolkata (the seeded institution timezone) for datetime-local inputs. */
export function istInput(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
