import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';

// ₹ + en-IN grouping + exactly 2 decimals — src/lib/format.js formatCurrency.
const CURRENCY_RE = /₹[\d,]+\.\d{2}/;
const nav = (page) => page.locator('nav');

test.describe('Partner Portal — Dashboard', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test.beforeEach(async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
  });

  test('stat cards render for Total Users, Total/Pending/Completed/Draft Orders', async ({ page }) => {
    for (const label of ['Total Users', 'Total Orders', 'Pending Orders', 'Completed Orders', 'Draft Orders']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('the order-status donut total matches the Total Orders stat card', async ({ page }) => {
    // Both come from the same `stats.total` value (src/pages/partner/PartnerDashboard.jsx)
    // — the donut just re-renders it inside the SVG, so this is a real
    // cross-widget consistency check, not a tautology on a single field.
    const statCard = page.locator('div.rounded-2xl.p-5', { has: page.getByText('Total Orders', { exact: true }) });
    const statValueLocator = statCard.locator('p.text-3xl');
    // Both the stat card and the donut show "..."/"Loading..." until the
    // /api/partner/orders fetch resolves — read only after it settles, or
    // this compares a stale placeholder against the real total.
    await expect(statValueLocator).not.toHaveText('...');
    const statValue = (await statValueLocator.textContent()).trim();

    const donutTotal = page.locator('svg[aria-label="Order status breakdown"] text').first();
    await expect(donutTotal).toHaveText(statValue);
  });

  test('Quick Actions navigate to the correct pages', async ({ page }) => {
    // Scoped to <main> — Sidebar (a sibling of <main> in Layout.jsx) has its
    // own "Create User"/"Manage Users" links, so an unscoped role query
    // matches two elements with the identical accessible name.
    const main = page.locator('main');
    // Returns to Dashboard via the sidebar's client-side <NavLink>, not
    // page.goto() — a hard reload re-runs AuthContext's /api/auth/me
    // bootstrap fetch, and that bootstrap's .catch() treats *any* fetch
    // failure (a transient network hiccup, not just a real 401) as "not
    // authenticated" and force-logs-out. Repeating that reload 2-3x a test
    // manufactures exposure to a hiccup that a real user, who navigates
    // within the SPA, would never hit. A plain client-side nav has no such
    // risk and matches how this UI is actually used.
    const goToDashboard = () => nav(page).getByRole('link', { name: 'Dashboard' }).click();

    await main.getByRole('link', { name: 'Create User', exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/users\/create$/);

    await goToDashboard();
    await main.getByRole('link', { name: 'Manage Users', exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/users$/);

    await goToDashboard();
    await main.getByRole('link', { name: 'View Orders', exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/orders$/);
  });
});

test.describe('Partner Portal — My Wallet (read-only)', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test('Current Balance and Available Balance always agree', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/wallet');
    await expect(page.getByRole('heading', { name: 'My Wallet' })).toBeVisible();

    // Both cards render `wallet.balance` — src/pages/partner/PartnerMyWallet.jsx's
    // `cards` array. If they ever diverge that's a real rendering bug.
    const currentBalanceLocator = page
      .locator('div.rounded-2xl.p-5', { has: page.getByText('Current Balance', { exact: true }) })
      .locator('p.text-2xl');
    // Shows "..." until the /api/partner/wallet fetch resolves.
    await expect(currentBalanceLocator).not.toHaveText('...');
    const currentBalance = await currentBalanceLocator.textContent();
    const availableBalance = await page
      .locator('div.rounded-2xl.p-5', { has: page.getByText('Available Balance', { exact: true }) })
      .locator('p.text-2xl')
      .textContent();

    expect(currentBalance.trim()).toMatch(CURRENCY_RE);
    expect(currentBalance.trim()).toBe(availableBalance.trim());
  });

  test('no credit/debit form is offered — wallet is view-only for partners', async ({ page }) => {
    // Per partner_portal_architecture memory: a partner can credit a user's
    // wallet, but cannot recharge/debit their own — deliberately no form here.
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/wallet');
    await expect(page.locator('input[type="number"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /credit|debit|recharge/i })).toHaveCount(0);
  });
});

test.describe('Partner Portal — Manage Services (read-only)', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test('renders either the assigned-services table or the empty state', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/services');
    await expect(page.getByRole('heading', { name: 'Manage Services' })).toBeVisible();

    const emptyState = page.getByText('No services have been assigned by the Super Admin.');
    const firstDataRow = page.locator('tbody tr').first();
    await expect(emptyState.or(firstDataRow)).toBeVisible();
  });
});

test.describe('Partner Portal — Orders list pages', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  const listPages = [
    { path: '/partner/orders', heading: 'My Orders' },
    { path: '/partner/orders/drafts', heading: 'Draft Orders' },
  ];

  for (const { path, heading } of listPages) {
    test(`${heading} renders its table without error`, async ({ page }) => {
      await loginAsPartner(page, partnerCreds);
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Order ID' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
    });
  }

  test('Create Order form loads with required-field markers, no live submit', async ({ page }) => {
    // Deliberately UI-only: which services are assigned to this test org
    // isn't known ahead of time, and some service names route through
    // SignDesk's UAT sandbox (eStamp Bulk / Manual eStamp) per the
    // signdesk_estamp_caution memory. Submitting isn't exercised here.
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/orders/create');
    await expect(page.getByRole('heading', { name: 'Create Order' })).toBeVisible();
    await expect(page.getByText('Customer Name *')).toBeVisible();
    await expect(page.getByText('Upload Document *')).toBeVisible();
  });
});
