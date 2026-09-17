import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';

// One protected route per portal (see src/App.jsx's four <Route path="/...">
// blocks) plus root and an unknown path, which both fall through to the same
// RootRedirect.
const PROTECTED_ROUTES = ['/admin/dashboard', '/superadmin/dashboard', '/partner/dashboard', '/user/dashboard'];

test.describe('Unauthenticated access', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('an unknown path redirects to /login', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('/login itself does not redirect', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('/set-password/:token is reachable without auth (public route)', async ({ page }) => {
    await page.goto('/set-password/not-a-real-token');
    await expect(page).not.toHaveURL(/\/login$/);
    // Bogus token — backend rejects it and the page renders its own error
    // state rather than the reset form.
    await expect(page.getByRole('heading', { name: /link invalid or expired/i })).toBeVisible();
  });
});

test.describe('Cross-portal role gating', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  // RequireRole (src/App.jsx) bounces a logged-in user who types another
  // portal's URL back to their own home before Layout/Sidebar even mount.
  const otherPortalRoutes = ['/admin/dashboard', '/superadmin/dashboard', '/user/dashboard'];
  for (const route of otherPortalRoutes) {
    test(`a partner login visiting ${route} is redirected back to /partner/dashboard`, async ({ page }) => {
      await loginAsPartner(page, partnerCreds);
      await page.goto(route);
      await expect(page).toHaveURL(/\/partner\/dashboard$/);
    });
  }
});
