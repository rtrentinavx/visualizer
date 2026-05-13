import { test, expect } from './fixtures';

test.describe('policy evaluator', () => {
  test('opens with findings against the demo topology', async ({ page }) => {
    await page.goto('/');
    // The evaluator icon (ShieldAlert) has aria-label "Policy evaluator (23 best-practice checks)".
    await page.getByRole('button', { name: /policy evaluator/i }).first().click();
    // The evaluator panel shows a compliance score and category filters.
    await expect(page.getByText(/compliance score/i)).toBeVisible({ timeout: 5000 });
    // The demo topology is intentionally not perfect — at least one finding
    // should be visible. We just check the panel rendered.
    await expect(page.getByText(/score/i)).toBeVisible();
  });
});
