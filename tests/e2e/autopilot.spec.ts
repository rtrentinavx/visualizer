import { test, expect } from './fixtures';

test.describe('autopilot modal', () => {
  test('opens, lists deterministic cards against the demo, toggles one off, and applies', async ({ page }) => {
    // Pre-mark achievements as unlocked so the demo-load toaster doesn't
    // intercept clicks on the modal we're about to open.
    await page.addInitScript(() => {
      const all: Record<string, string> = {};
      ['first-policy', 'first-group', 'ten-policies', 'evaluator-perfect-score']
        .forEach((id) => { all[id] = new Date().toISOString(); });
      localStorage.setItem('dcf-achievements-v1', JSON.stringify(all));
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });

    // Open Autopilot via the toolbar button.
    await page.locator('[data-tour="autopilot-btn"]').click();
    await expect(page.getByRole('heading', { name: /^autopilot$/i })).toBeVisible({ timeout: 5000 });

    // The demo topology has fixable evaluator findings (e.g., the WebGroup
    // egress one and naming/logging hygiene issues) plus likely needs a
    // priority renumber — so we expect at least one card to be present.
    const cardCount = await page.locator('label:has(input[type="checkbox"])').count();
    expect(cardCount).toBeGreaterThan(0);

    // The Apply button starts enabled (defaultEnabled cards are checked).
    const applyBtn = page.getByRole('button', { name: /^apply$/i });
    await expect(applyBtn).toBeEnabled();

    // Disable everything via the "None" shortcut → the diff goes empty and
    // Apply becomes disabled.
    await page.getByRole('button', { name: /^none$/i }).click();
    await expect(page.getByText(/no changes selected/i)).toBeVisible();
    await expect(applyBtn).toBeDisabled();

    // Re-enable everything and apply.
    await page.getByRole('button', { name: /^all$/i }).click();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();

    // Modal closes; we should be back on the matrix view. Re-open and verify
    // there are now FEWER cards (some fixes have been applied).
    await expect(page.getByRole('heading', { name: /^autopilot$/i })).toBeHidden({ timeout: 5000 });
    await page.locator('[data-tour="autopilot-btn"]').click();
    await expect(page.getByRole('heading', { name: /^autopilot$/i })).toBeVisible({ timeout: 5000 });
    const cardCountAfter = await page.locator('label:has(input[type="checkbox"])').count();
    expect(cardCountAfter).toBeLessThan(cardCount);
  });
});
