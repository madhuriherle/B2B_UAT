import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';

test.describe('Partner Portal sidebar navigation', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test.beforeEach(async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
  });

  // Sidebar.jsx's menu <nav> is a sibling of <main> in Layout.jsx, but several
  // sidebar link labels are duplicated by Dashboard's Quick Actions tiles
  // ("Create User", "Manage Users") which also live in the accessible tree —
  // every lookup below is scoped to <nav> so it can't resolve to the wrong one.
  const nav = (page) => page.locator('nav');

  // Flat top-level items — src/components/Sidebar.jsx partnerMenus.
  test('Dashboard link is active on load', async ({ page }) => {
    await expect(nav(page).getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('Manage Services navigates to /partner/services', async ({ page }) => {
    await nav(page).getByRole('link', { name: 'Manage Services' }).click();
    await expect(page).toHaveURL(/\/partner\/services$/);
    await expect(page.getByRole('heading', { name: 'Manage Services' })).toBeVisible();
  });

  // Grouped submenus — clicking the parent toggles a <div>, not a NavLink.
  // Sidebar.jsx auto-re-expands whichever submenu contains the current route
  // on every navigation (see its location.pathname effect), so once a group
  // is open it stays open across the links below without re-clicking the
  // toggle.
  test('Users submenu expands and links to Create User / Manage Users', async ({ page }) => {
    // Sidebar.jsx initializes `openMenu` to "Users" (`useState("Users")`), so
    // on a fresh Dashboard load this group is already open — clicking the
    // toggle here would close it instead of opening it.
    await expect(nav(page).getByRole('link', { name: 'Create User' })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Create User' }).click();
    await expect(page).toHaveURL(/\/partner\/users\/create$/);
    await expect(page.getByRole('heading', { name: 'Create User' })).toBeVisible();

    await nav(page).getByRole('link', { name: 'Manage Users' }).click();
    await expect(page).toHaveURL(/\/partner\/users$/);
    await expect(page.getByRole('heading', { name: 'Manage Users' })).toBeVisible();
  });

  test('Wallet submenu expands and links to My Wallet / User Wallets / Transactions', async ({ page }) => {
    await nav(page).getByRole('button', { name: 'Wallet' }).click();

    await nav(page).getByRole('link', { name: 'My Wallet' }).click();
    await expect(page).toHaveURL(/\/partner\/wallet$/);
    await expect(page.getByRole('heading', { name: 'My Wallet' })).toBeVisible();

    await nav(page).getByRole('link', { name: 'User Wallets' }).click();
    await expect(page).toHaveURL(/\/partner\/wallet\/users$/);
    await expect(page.getByRole('heading', { name: 'User Wallets' })).toBeVisible();

    await nav(page).getByRole('link', { name: 'Transactions' }).click();
    await expect(page).toHaveURL(/\/partner\/wallet\/transactions$/);
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  });

  test('Reports submenu links to SBTR / Challan Reports', async ({ page }) => {
    await nav(page).getByRole('button', { name: 'Reports' }).click();
    await nav(page).getByRole('link', { name: 'SBTR / Challan Reports' }).click();
    await expect(page).toHaveURL(/\/partner\/reports\/sbtr-challans$/);
    await expect(page.getByRole('heading', { name: 'SBTR / Challan Reports' })).toBeVisible();
  });

  test('sidebar identifies the portal and the logged-in role', async ({ page }) => {
    await expect(page.getByText('Partner Portal')).toBeVisible();
    // Sidebar.jsx renders user.role verbatim ("partner") and CSS-capitalizes
    // it for display — the DOM text content itself stays lowercase. Header.jsx
    // also shows the role next to the profile avatar, so this is scoped to
    // Sidebar's own (uniquely "truncate"-classed) role paragraph.
    await expect(page.locator('p.truncate.capitalize', { hasText: 'partner' })).toBeVisible();
  });
});
