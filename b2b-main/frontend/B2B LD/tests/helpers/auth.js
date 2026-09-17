import { expect } from '@playwright/test';

// src/pages/Login.jsx's <input> elements have no `name`/`id`, and their
// <label> is a plain sibling with no `htmlFor` — there's no accessible-name
// or test-id association to hook into anywhere in this app (confirmed by
// grepping for data-testid: zero hits). A type-attribute locator is the
// most stable selector available without touching app source.
export const loginAs = async (page, { email, password }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
};

export const loginAsPartner = async (page, creds) => {
  await loginAs(page, creds);
  await expect(page).toHaveURL(/\/partner\/dashboard$/);
};

// superadmin@gmail.com resolves to role='admin' (Super Admin Portal,
// base /superadmin) — confirmed against the real /api/auth/login response,
// not assumed from the "superadmin" login label. See roleHome.js's
// PORTAL_BASE map: role='admin' -> /superadmin, role='platform_admin' -> /admin.
export const loginAsAdmin = async (page, creds) => {
  await loginAs(page, creds);
  await expect(page).toHaveURL(/\/superadmin\/dashboard$/);
};

export const loginAsMember = async (page, creds) => {
  await loginAs(page, creds);
  await expect(page).toHaveURL(/\/user\/dashboard$/);
};

export const logout = async (page) => {
  await page.getByRole('button', { name: /logout/i }).click();
  await expect(page).toHaveURL(/\/login$/);
};
