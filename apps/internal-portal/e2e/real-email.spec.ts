import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';

/**
 * Real emailed sign-in codes (app/api/sign-in), end to end. Runs only when the
 * console was started with email configured and EMAIL_TEST_OUTBOX set
 * (playwright.real-email.config.ts), where the "sent" email lands in a file.
 */
const OUTBOX = process.env.EMAIL_TEST_OUTBOX;
test.skip(!OUTBOX, 'needs the console started with real-email settings');

function lastCodeFor(email: string): string {
  const lines = existsSync(OUTBOX!) ? readFileSync(OUTBOX!, 'utf8').trim().split('\n').filter(Boolean) : [];
  const mine = lines.map((l) => JSON.parse(l)).filter((m) => m.to === email);
  const subject: string = mine.at(-1)?.subject ?? '';
  return subject.match(/^(\d{6}) /)?.[1] ?? '';
}

test.describe.configure({ mode: 'serial' });

test('the code arrives by email and signs in; no demo code, no demo panel', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByText('Demo mode')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Email' }).fill('kavya@test.in');
  await page.getByRole('button', { name: /^Send me a code/ }).click();
  await expect(page.getByText(/Code expires in (4:00|3:5\d)/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => lastCodeFor('kavya@test.in')).toMatch(/^\d{6}$/);
  const code = lastCodeFor('kavya@test.in');
  // The old demo code does not work.
  if (code !== '123456') {
    await page.getByLabel('Digit 1').fill('123456');
    await expect(page.getByText(/That code is wrong/)).toBeVisible();
  }
  await page.getByLabel('Digit 1').fill(code);
  await expect(page).not.toHaveURL(/\/signin$/, { timeout: 30_000 });
  // Signed in as the person and role on the server's list.
  await expect(page.getByText('Kavya S').first()).toBeVisible({ timeout: 30_000 });
});

test('someone not on the list gets no email', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('textbox', { name: 'Email' }).fill('stranger@test.in');
  await page.getByRole('button', { name: /^Send me a code/ }).click();
  await expect(page.getByText('This email is not allowed to sign in. Ask an administrator to add it.')).toBeVisible();
  expect(lastCodeFor('stranger@test.in')).toBe('');
});

test('the email itself: company sender, code, four minutes', async () => {
  const lines = readFileSync(OUTBOX!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const m = lines.find((x) => x.to === 'kavya@test.in');
  expect(m.from).toBe('Nexraah <no-reply@test.in>');
  expect(m.subject).toMatch(/^\d{6} is your Nexraah sign-in code$/);
  expect(m.text).toContain('expires in 4 minutes');
  expect(m.html).toContain('Your sign-in code');
});
