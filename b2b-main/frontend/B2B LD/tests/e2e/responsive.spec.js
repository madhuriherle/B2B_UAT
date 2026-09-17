import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';

// This app has no mobile nav pattern (no hamburger/collapsible sidebar — the
// Sidebar is a fixed w-64 column at every viewport, per src/components/Sidebar.jsx).
// So "responsive" here means what the source actually implements: the Login
// page's own responsive classes (px-4, max-w-sm), each data table wrapped in
// its own `overflow-x-auto` so it scrolls internally instead of the whole
// page, and Header's `hidden sm:block` breakpoint on the profile name/role.
// These checks verify those specific, existing behaviors — not a redesign
// this suite is inventing.

const noHorizontalOverflow = async (page) => {
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1 for sub-pixel rounding
};

test.describe('Responsive — Login page', () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    test(`no horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await noHorizontalOverflow(page);
    });
  }
});

test.describe('Responsive — Partner Portal', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test('Dashboard has no page-level horizontal scroll at mobile width despite wide tables', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsPartner(page, partnerCreds);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('Manage Users table stays scrollable within its own container, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/users');
    await expect(page.getByRole('heading', { name: 'Manage Users' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('Header profile name/role is hidden below the sm breakpoint and shown above it', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    // src/components/Header.jsx wraps the name/role text in `hidden sm:block`
    // — the avatar circle next to it has no such wrapper and stays visible
    // at every width, so this is specifically testing that one breakpoint.
    const profileName = page.locator('header p.text-sm.font-semibold');

    await page.setViewportSize({ width: 500, height: 800 });
    await expect(profileName).toBeHidden();

    await page.setViewportSize({ width: 900, height: 800 });
    await expect(profileName).toBeVisible();
  });
});
