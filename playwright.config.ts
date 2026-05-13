import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — UI / flow tier, sits alongside Vitest (logic tier).
 *
 * Scope locks (per design review):
 * - Chromium only. Add Firefox / WebKit later if we hit a browser-specific bug.
 * - Runs against the BUILT bundle via `vite preview` (matches what Vercel
 *   ships) — slower boot than `vite dev`, but exercises the real code path.
 * - `/api/*` is stubbed per-test via page.route(); the preview server does NOT
 *   include the Vercel serverless functions, so unmocked calls would 404.
 * - localStorage is real — we want to exercise the encrypted-storage
 *   round-trip end-to-end.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `vite preview` serves the production-built bundle from /dist on 4173.
    // We rebuild before the suite via `npm run build` chained in test:e2e.
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
