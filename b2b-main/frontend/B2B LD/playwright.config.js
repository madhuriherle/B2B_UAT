// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Loads tests/.env.test if present (Node >=20.6 built-in, no extra
// dependency). Optional — CI or a shell that already exports the vars
// doesn't need the file. See tests/.env.test.example for the full list of
// variables this suite reads and what each one is for.
try {
  process.loadEnvFile('tests/.env.test');
} catch {
  // File doesn't exist — fine, fall back to whatever's already in the env.
}

// Every test/helper reads this from tests/fixtures/env.js rather than
// hardcoding a URL — override with `BASE_URL=... npx playwright test`.
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // This suite talks to whatever's already running at BASE_URL (Vite dev
  // server) and to the FastAPI backend it proxies /api to — both must be
  // started manually first. Not auto-started here since the backend isn't
  // this frontend package's responsibility to launch.
});
