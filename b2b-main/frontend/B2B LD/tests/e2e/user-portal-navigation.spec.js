import { test, expect } from '@playwright/test';
import { memberCreds, hasMemberCreds } from '../fixtures/env.js';
import { loginAsMember } from '../helpers/auth.js';

// role='member' (User Portal, base /user) — a Retailer org's own onboarding
// login, per admin-onboard-retailer.spec.js. Sidebar.jsx's partnerUserMenus
// has 5 entries (Dashboard, My Orders, Services, My Wallet, Invoices) — note
// there is NO "Reports" sidebar entry for this role even though the
// /user/reports/sbtr-challans route and page both exist, so that one is
// checked by direct navigation instead of a sidebar click.
test.describe('User Portal (member role) — navigation', () => {
  test.skip(!hasMemberCreds(), 'TEST_MEMBER_EMAIL/TEST_MEMBER_PASSWORD not set — see tests/.env.test.example');

  test.beforeEach(async ({ page }) => {
    await loginAsMember(page, memberCreds);
  });

  // Scoped to <nav> — Dashboard's Quick Actions include a "View My Orders"
  // tile whose accessible name contains "My Orders" as a substring, which
  // Playwright's default (non-exact) role-name matching would otherwise
  // resolve ambiguously against the sidebar's own "My Orders" link.
  const nav = (page) => page.locator('nav');

  test('lands on Dashboard and identifies the User Portal', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('User Portal')).toBeVisible();
  });

  test('My Orders navigates from the sidebar', async ({ page }) => {
    await nav(page).getByRole('link', { name: 'My Orders' }).click();
    await expect(page).toHaveURL(/\/user\/orders$/);
    await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();
  });

  test('Services navigates from the sidebar', async ({ page }) => {
    await nav(page).getByRole('link', { name: 'Services' }).click();
    await expect(page).toHaveURL(/\/user\/services$/);
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
  });

  test('My Wallet navigates from the sidebar', async ({ page }) => {
    await nav(page).getByRole('link', { name: 'My Wallet' }).click();
    await expect(page).toHaveURL(/\/user\/wallet$/);
    await expect(page.getByRole('heading', { name: 'My Wallet' })).toBeVisible();
  });

  test('Invoices navigates from the sidebar', async ({ page }) => {
    await nav(page).getByRole('link', { name: 'Invoices' }).click();
    await expect(page).toHaveURL(/\/user\/invoices$/);
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  });

  test('SBTR / Challan Reports renders when reached by direct URL', async ({ page }) => {
    await page.goto('/user/reports/sbtr-challans');
    await expect(page.getByRole('heading', { name: 'SBTR / Challan Reports' })).toBeVisible();
  });

  test('a fresh Retailer login has no services assigned yet — Create Order shows the contact-admin state', async ({ page }) => {
    // admin-onboard-retailer.spec.js deliberately leaves every service
    // disabled for this org, so this is the expected state, not a bug.
    await page.goto('/user/orders/create');
    const contactAdminNotice = page.getByText(/no services are enabled|contact.*admin/i);
    await expect(contactAdminNotice).toBeVisible();
  });
});
