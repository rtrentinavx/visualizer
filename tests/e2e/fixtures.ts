import { test as base, type Page } from '@playwright/test';

/**
 * Pre-populate localStorage flags so the welcome modals (recommendations,
 * onboarding tour) don't intercept the first interaction. Tests that
 * *want* to exercise the welcome flow can construct a page without this
 * (use the base `test` from '@playwright/test' directly).
 *
 * Keys mirror the actual storage keys used in `src/lib/*Dismissal.ts`.
 */
async function dismissWelcomeFlows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('dcf-recommendations-dismissed', 'true');
    localStorage.setItem('dcf-tour-auto-shown', 'true');
  });
}

/**
 * Custom Playwright fixture that pre-stubs every `/api/*` route so tests run
 * against the `vite preview` server (which doesn't include the Vercel
 * serverless functions). Without this, any feature that hits the proxy would
 * 404 and timeout the test.
 *
 * Per-test overrides: a test can install its own `page.route()` AFTER this
 * fixture runs to mock specific responses (e.g. an AI streaming reply).
 * Routes are matched in registration order, so per-test routes win.
 *
 * What's stubbed by default:
 * - `/api/ai/proxy`        → 200 with a canned `data: ... \n\n data: [DONE]` SSE chunk.
 * - `/api/ai/models`       → 200 with a tiny model list.
 * - `/api/ai/moderate`     → 200 not-flagged.
 * - `/api/topology` GET    → 404 (nothing in cloud).
 * - `/api/topology` POST   → 200 success.
 *
 * Tests that don't touch AI or cloud sync are unaffected.
 */
export async function installApiStubs(page: Page): Promise<void> {
  await page.route('**/api/ai/proxy', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    // OpenAI-shape SSE: single chunk + DONE. parseSSELine in client.ts handles this.
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'data: {"choices":[{"delta":{"content":"stubbed AI response"}}]}\n\ndata: [DONE]\n\n',
    });
  });

  await page.route('**/api/ai/models', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }),
    });
  });

  await page.route('**/api/ai/moderate', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flagged: false, categories: [] }),
    });
  });

  await page.route('**/api/topology**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Not found' }),
      });
      return;
    }
    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Extended `test` that installs the API stubs before every test in the suite.
 * Use this instead of importing `test` from '@playwright/test' directly so the
 * default-stubbed behavior is consistent across the suite.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await dismissWelcomeFlows(page);
    await installApiStubs(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
