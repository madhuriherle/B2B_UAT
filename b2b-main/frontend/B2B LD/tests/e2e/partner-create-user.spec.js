import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';
import { testUserPayload } from '../helpers/testData.js';

test.describe('Partner Portal — Create User', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test.beforeEach(async ({ page }) => {
    await loginAsPartner(page, partnerCreds);
    await page.goto('/partner/users/create');
  });

  test('rejects submit with all fields empty', async ({ page }) => {
    await page.getByRole('button', { name: 'Save User' }).click();
    await expect(page.getByText('Full name, email and mobile number are required')).toBeVisible();
    await expect(page).toHaveURL(/\/partner\/users\/create$/);
  });

  test('rejects an invalid mobile number', async ({ page }) => {
    await page.locator('input[name="full_name"]').fill('PW Validation Check');
    await page.locator('input[name="email"]').fill('pw-validation@example.com');
    // sanitizeMobileInput strips non-digits and caps at 10 — "12345" alone
    // is a too-short but otherwise-valid-looking number.
    await page.locator('input[name="mobile"]').fill('12345');
    await page.getByRole('button', { name: 'Save User' }).click();
    await expect(page.getByText('Mobile number must be exactly 10 digits')).toBeVisible();
  });

  test('mobile field strips non-numeric characters as you type', async ({ page }) => {
    await page.locator('input[name="mobile"]').fill('98a76b54c3-2');
    await expect(page.locator('input[name="mobile"]')).toHaveValue('9876543');
  });

  test('creates a user with valid data and it appears in Manage Users', async ({ page }) => {
    const { fullName, email, mobile } = testUserPayload();

    await page.locator('input[name="full_name"]').fill(fullName);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="mobile"]').fill(mobile);
    await page.getByRole('button', { name: 'Save User' }).click();

    // Successful create navigates back to the list. Given the extra margin
    // (default expect timeout is 5s): against a local single-process dev
    // uvicorn this POST has been observed taking a few seconds longer than
    // that under general load — a slow response, not a failed one (the
    // button's own "Saving..." state was still showing at the 5s mark when
    // this was diagnosed).
    await expect(page).toHaveURL(/\/partner\/users$/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Manage Users' })).toBeVisible();

    // Filter down to the row we just created instead of scanning the whole
    // table, which may have other partners' users in it.
    await page.getByPlaceholder('Search by name or email...').fill(email);
    const row = page.locator('tbody tr', { hasText: email });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(fullName)).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();
  });

  test('rejects creating a user with an email already in use', async ({ page }) => {
    // The partner login's own email already has an organization_users row
    // for this org (that's what get_current_partner resolves off of — see
    // backend/app/auth.py), so POST /api/partner/users 409s with this exact
    // message (backend/app/routes/partner.py create_partner_user).
    await page.locator('input[name="full_name"]').fill('PW Duplicate Email Check');
    await page.locator('input[name="email"]').fill(partnerCreds.email);
    await page.locator('input[name="mobile"]').fill('9123456780');
    await page.getByRole('button', { name: 'Save User' }).click();
    await expect(page.getByText(`'${partnerCreds.email}' is already a user in your organization`)).toBeVisible();
    await expect(page).toHaveURL(/\/partner\/users\/create$/);
  });
});
