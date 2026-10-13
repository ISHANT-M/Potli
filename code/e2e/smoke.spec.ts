import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Password comes from backend/.env at runtime and is never printed. */
function seedPassword(): string {
  const file = path.join(import.meta.dirname, '../backend/.env');
  const match = /^DEV_SEED_PASSWORD=(.*)$/m.exec(fs.readFileSync(file, 'utf8'));
  if (!match?.[1]) throw new Error('DEV_SEED_PASSWORD missing in backend/.env');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

const TRAVELLER = 'aanshaj_be24@thapar.edu';
const ADMIN = 'imehndiratta_be24@thapar.edu';

async function login(page: Page, hash: '#/login' | '#/admin/login', email: string) {
  await page.goto(`/${hash}`);
  await page.fill('#login-form input[name=email]', email);
  await page.fill('#login-form input[name=password]', seedPassword());
  await page.click('#login-form button[type=submit]');
}

test('landing renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Leave the bags');
});

test('search shows results for Patiala', async ({ page }) => {
  await page.goto('/#/search?q=Patiala');
  await expect(page.locator('.cx-card').first()).toBeVisible({ timeout: 20_000 });
});

test('traveller books with cash on pickup, sees OTP, cancels', async ({ page }) => {
  await login(page, '#/login', TRAVELLER);
  await expect(page).not.toHaveURL(/#login/);
  await page.goto('/#/search?q=Patiala');
  await page.locator('.cx-card h3 a').first().click();
  const go = page.locator('#w-go');
  await expect(go).not.toHaveAttribute('aria-disabled', 'true', { timeout: 20_000 });
  await go.click();
  await expect(page.locator('input[name=pay][value=cod]')).toBeChecked();
  await expect(page.locator('input[name=pay][value=upi]')).toBeDisabled();
  await expect(page.locator('input[name=pay][value=card]')).toBeDisabled();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('.cx-otp')).toHaveText(/^\d{6}$/, { timeout: 20_000 });
  await page.click('#cancel');
  await page.getByRole('button', { name: 'Cancel booking' }).last().click();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
});

test('traveller is forbidden from admin', async ({ page }) => {
  await login(page, '#/login', TRAVELLER);
  await expect(page).not.toHaveURL(/#login/);
  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'This area is not for your account' })).toBeVisible();
});

test('admin overview loads', async ({ page }) => {
  await login(page, '#/admin/login', ADMIN);
  await expect(page.getByRole('heading', { name: 'Bookings by status' })).toBeVisible({ timeout: 20_000 });
});
