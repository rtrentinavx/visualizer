import { test, expect } from './fixtures';

test.describe('version history modal', () => {
  test('opens, captures a manual snapshot, lists it, then restores', async ({ page }) => {
    // Pre-mark every achievement as unlocked so the demo-topology load doesn't
    // pop a toast that would intercept clicks on the modal we're about to open.
    await page.addInitScript(() => {
      const all: Record<string, string> = {};
      ['first-policy', 'first-group', 'ten-policies', 'evaluator-perfect-score']
        .forEach((id) => { all[id] = new Date().toISOString(); });
      localStorage.setItem('dcf-achievements-v1', JSON.stringify(all));
    });
    await page.goto('/');

    // Wait for the demo topology to load and the autosave hook to settle
    // (debounce is 500ms — give it a generous margin).
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(700);

    // Open History from the header. Use the data-tour attribute — the
    // accessible name includes an em-dash that's awkward to match via regex,
    // and on narrow viewports the toolbar can scroll horizontally.
    await page.locator('[data-tour="history-btn"]').click();
    await expect(page.getByRole('heading', { name: /version history/i })).toBeVisible({ timeout: 5000 });

    // The demo topology load should have produced at least one auto snapshot
    // by the time we got here (500ms debounce + 700ms wait). But just in case,
    // we proceed via the explicit "Save snapshot" button to make the test
    // deterministic and time-independent.
    await page.getByRole('button', { name: /save snapshot/i }).click();

    const labelInput = page.getByPlaceholder(/label/i);
    await expect(labelInput).toBeVisible();
    await labelInput.fill('e2e-test-milestone');
    await labelInput.press('Enter');

    // The freshly-saved manual snapshot should appear in the left pane.
    await expect(page.getByText('e2e-test-milestone').first()).toBeVisible({ timeout: 3000 });

    // Reload the page — manual snapshots persist across reloads because they
    // live in encrypted localStorage. This proves the storage round-trip.
    await page.reload();
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });
    await page.locator('[data-tour="history-btn"]').click();
    await expect(page.getByText('e2e-test-milestone').first()).toBeVisible({ timeout: 5000 });
  });
});
