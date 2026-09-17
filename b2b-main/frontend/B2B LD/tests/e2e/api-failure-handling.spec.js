import { test, expect } from '@playwright/test';
import { partnerCreds, hasPartnerCreds } from '../fixtures/env.js';
import { loginAsPartner } from '../helpers/auth.js';

// src/lib/api.js's apiRequest() is the single fetch wrapper every page in
// this app goes through, with exactly two failure paths worth verifying:
// (1) the fetch() call itself throws (network unreachable) and (2) the
// backend responds but with a non-2xx status. Intercepting via page.route
// exercises both without needing the real backend to actually be down.

test.describe('Network failure handling', () => {
  test('login shows a clear message when the backend is unreachable', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => route.abort('connectionrefused'));
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('someone@example.com');
    await page.locator('input[type="password"]').fill('whatever123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Cannot reach the server at', { exact: false })).toBeVisible();
  });

  test('login surfaces a 500 backend error instead of crashing the page', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal Server Error' }) })
    );
    await page.goto('/login');
    await page.locator('input[type="email"]').fill('someone@example.com');
    await page.locator('input[type="password"]').fill('whatever123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('Internal Server Error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a 422 validation-array response is rendered as readable text, not "[object Object]"', async ({ page }) => {
    // FastAPI's own validation errors shape `detail` as an array of
    // {loc, msg, type} objects — api.js's extractErrorMessage exists
    // specifically to flatten that instead of stringifying the array.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' }] }),
      })
    );
    await page.goto('/login');
    // Not "not-an-email" — the <input type="email"> has native HTML5
    // constraint validation (Login.jsx wraps it in a plain <form>), which
    // blocks submission before React's onSubmit ever runs for a value that
    // fails the browser's own (lenient, no-TLD-required) email pattern.
    // "test@example" passes that native check but still lets this test
    // exercise the mocked 422 response.
    await page.locator('input[type="email"]').fill('test@example');
    await page.locator('input[type="password"]').fill('whatever123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText('value is not a valid email address')).toBeVisible();
    await expect(page.getByText('[object Object]')).toHaveCount(0);
  });
});

test.describe('Session handling on API failure', () => {
  test.skip(!hasPartnerCreds(), 'TEST_PARTNER_EMAIL/TEST_PARTNER_PASSWORD not set — see tests/.env.test.example');

  test('a 401 on any authenticated call clears the session and bounces to /login', async ({ page }) => {
    await loginAsPartner(page, partnerCreds);

    await page.route('**/api/partner/users', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Session expired, please log in again' }) })
    );
    await page.goto('/partner/users');

    await expect(page).toHaveURL(/\/login$/);
    const token = await page.evaluate(() => sessionStorage.getItem('b2b_admin_token'));
    expect(token).toBeNull();
  });
});
