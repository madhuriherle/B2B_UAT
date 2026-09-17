import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAs, loginAsPartner, logout } from '../helpers/auth.js';

test.describe('Login page', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('rejects an empty submit with a client-side validation message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Enter your email and password')).toBeVisible();
    // Never left /login — no request should have been attempted.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('shows the server error for invalid credentials', async ({ page }) => {
    await loginAs(page, { email: 'not-a-real-user@example.com', password: 'wrong-password-123' });
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('does not submit with only an email filled in', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('someone@example.com');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Enter your email and password')).toBeVisible();
  });
});

test.describe('Partner login/logout', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test('logs in and lands on the Partner Portal dashboard', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Partner Portal')).toBeVisible();
  });

  test('session survives a full page reload (GET /api/auth/me)', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await page.reload();
    // A prior bug sent every partner-role user back to /login on reload
    // because /api/auth/me was admin-gated (see partner_portal_architecture
    // memory) — this is the regression this test guards against.
    await expect(page).toHaveURL(/\/partner\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('logout clears the session and blocks back-navigation into the portal', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await logout(page);

    // sessionStorage should be empty post-logout.
    const token = await page.evaluate(() => sessionStorage.getItem('b2b_admin_token'));
    expect(token).toBeNull();

    await page.goto('/partner/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
