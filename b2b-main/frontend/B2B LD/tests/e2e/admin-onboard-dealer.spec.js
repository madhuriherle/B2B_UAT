import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { adminCreds, hasAdminCreds } from '../fixtures/env.js';
import { loginAsAdmin } from '../helpers/auth.js';
import { testDealerOrgPayload, testPartnerUserPayload } from '../helpers/testData.js';

// Live end-to-end onboarding: Super Admin creates a Dealer-type partner org
// through the real 3-step Customer Onboard wizard. A Dealer org's Step-2
// user is created with a real password (see organizations.py
// create_or_link_organization_user: portal_role = 'partner' for Dealer
// orgs, and a supplied password sets an active password_hash immediately —
// no email-invite step needed), so this test writes the generated
// credentials to tests/.generated-partner.json for the rest of the suite
// (partner-*.spec.js) to consume via tests/.env.test.
test.describe('Super Admin — onboard a Dealer partner', () => {
  test.skip(!hasAdminCreds(), 'TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD not set — see tests/.env.test.example');

  test('creates a Dealer org + partner login end-to-end via Customer Onboard', async ({ page }) => {
    const org = testDealerOrgPayload();
    const partnerUser = testPartnerUserPayload();

    await test.step('login as Super Admin', async () => {
      await loginAsAdmin(page, adminCreds);
      await expect(page.getByText('Super Admin Portal')).toBeVisible();
    });

    await test.step('Step 1 — Partner Details', async () => {
      await page.goto('/superadmin/customer-onboard');
      await expect(page.getByRole('heading', { name: 'Customer Onboard' })).toBeVisible();

      await page.locator('input[name="organizationName"]').fill(org.organizationName);
      await page.locator('select[name="organizationType"]').selectOption('Dealer');
      await page.locator('input[name="email"]').fill(org.email);
      await page.locator('input[name="mobile"]').fill(org.mobile);
      await page.getByRole('button', { name: 'Save Partner' }).click();

      // Blocking success modal — must be dismissed before Step 2 is usable.
      await expect(page.getByText('Partner Saved Successfully')).toBeVisible();
      await page.getByRole('button', { name: 'OK' }).click();
      await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
    });

    await test.step('Step 2 — add a Partner user with a real password', async () => {
      await expect(page.getByRole('heading', { name: 'Partner Users' })).toBeVisible();
      await page.locator('input[name="fullName"]').first().fill(partnerUser.fullName);
      await page.locator('input[name="email"]').last().fill(partnerUser.email);
      await page.locator('input[name="mobile"]').last().fill(partnerUser.mobile);
      await page.locator('input[name="password"]').first().fill(partnerUser.password);
      await page.getByRole('button', { name: 'Save User' }).click();
      await expect(page.getByText(/User 1 saved/)).toBeVisible();

      await page.getByRole('button', { name: 'Next: Services' }).click();
    });

    await test.step('Step 3 — finish onboarding without enabling services', async () => {
      // Deliberately leaves every service disabled — org-level pricing setup
      // is out of scope for this journey and not needed to prove the
      // onboarding + login flow works. Manage Services' "no services
      // assigned" empty state is already covered by partner-dashboard-wallet.spec.js.
      await expect(page.getByRole('heading', { name: 'Partner Services' })).toBeVisible();
      await page.getByRole('button', { name: 'Create Partner' }).click();
      await expect(page).toHaveURL(/\/superadmin\/customer-list$/);
    });

    await test.step('verify the new partner appears in Partner List', async () => {
      await expect(page.getByRole('heading', { name: 'Partner List' })).toBeVisible();
      await page.getByPlaceholder('Search partners...').fill(org.organizationName);
      await expect(page.getByText(org.organizationName)).toBeVisible();
    });

    // Persist the generated, real, immediately-loginable partner credentials
    // for the rest of the suite. Gitignored — see .gitignore's
    // "tests/.generated-*.json" entry.
    fs.writeFileSync(
      'tests/.generated-partner.json',
      JSON.stringify({ email: partnerUser.email, password: partnerUser.password, organizationName: org.organizationName }, null, 2)
    );
  });
});
