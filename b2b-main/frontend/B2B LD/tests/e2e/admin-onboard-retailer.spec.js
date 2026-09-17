import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { adminCreds, hasAdminCreds } from '../fixtures/env.js';
import { loginAsAdmin } from '../helpers/auth.js';
import { testRetailerOrgPayload } from '../helpers/testData.js';

// Live end-to-end onboarding: Super Admin creates a Retailer-type partner
// org. Unlike Dealer orgs, a Retailer's Step-1 form captures a password
// directly and the backend links that identity as role='member' — Retailer
// partners skip the Partner Portal entirely and log straight into the User
// Portal (see CustomerOnboard.jsx's comment on handleSaveOrganization and
// organizations.py's create_or_link_organization_user portal_role logic).
// This test writes the generated credentials to
// tests/.generated-member.json for the rest of the suite to consume.
test.describe('Super Admin — onboard a Retailer partner (direct User Portal login)', () => {
  test.skip(!hasAdminCreds(), 'TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD not set — see tests/.env.test.example');

  test('creates a Retailer org + member login end-to-end via Customer Onboard', async ({ page }) => {
    const org = testRetailerOrgPayload();

    await test.step('login as Super Admin', async () => {
      await loginAsAdmin(page, adminCreds);
    });

    await test.step('Step 1 — Partner Details (Retailer, with password)', async () => {
      await page.goto('/superadmin/customer-onboard');
      await page.locator('input[name="organizationName"]').fill(org.organizationName);
      await page.locator('select[name="organizationType"]').selectOption('Retailer');
      await page.locator('select[name="retailerCategory"]').selectOption('Banks');
      await page.locator('input[name="password"]').fill(org.password);
      await page.locator('input[name="email"]').fill(org.email);
      await page.locator('input[name="mobile"]').fill(org.mobile);
      await page.getByRole('button', { name: 'Save Partner' }).click();

      await expect(page.getByText('Partner Saved Successfully')).toBeVisible();
      await page.getByRole('button', { name: 'OK' }).click();
      // Retailer orgs skip straight to Step 3 — no separate Users card.
      await expect(page.getByRole('heading', { name: 'Partner Services' })).toBeVisible();
    });

    await test.step('Step 3 — finish onboarding without enabling services', async () => {
      await page.getByRole('button', { name: 'Create Partner' }).click();
      await expect(page).toHaveURL(/\/superadmin\/customer-list$/);
    });

    await test.step('verify the new partner appears in Partner List', async () => {
      await expect(page.getByRole('heading', { name: 'Partner List' })).toBeVisible();
      await page.getByPlaceholder('Search partners...').fill(org.organizationName);
      await expect(page.getByText(org.organizationName)).toBeVisible();
    });

    fs.writeFileSync(
      'tests/.generated-member.json',
      JSON.stringify({ email: org.email, password: org.password, organizationName: org.organizationName }, null, 2)
    );
  });
});
