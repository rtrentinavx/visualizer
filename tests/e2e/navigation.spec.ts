import { test, expect } from './fixtures';

test.describe('view navigation', () => {
  test('clicking each tab swaps the visible view', async ({ page }) => {
    await page.goto('/');

    // Matrix is the default.
    await expect(page.getByRole('heading', { name: /policy matrix/i })).toBeVisible();

    // Graph tab → lazy-loaded chunk; allow extra time for the import.
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({ timeout: 5000 });

    // Traffic tab → the merged simulator + saved-flows view.
    await page.getByRole('button', { name: 'Traffic' }).click();
    await expect(page.getByRole('heading', { name: /traffic simulator/i })).toBeVisible();
    await expect(page.getByText(/SAVED FLOWS/i)).toBeVisible();

    // Back to Matrix.
    await page.getByRole('button', { name: 'Matrix' }).click();
    await expect(page.getByRole('heading', { name: /policy matrix/i })).toBeVisible();
  });

  test('corner AI button opens the AI Settings view', async ({ page }) => {
    await page.goto('/');
    // The corner cluster pinned at the far right: Bot icon = AI configuration.
    await page.getByRole('button', { name: 'AI configuration' }).click();
    await expect(page.getByRole('heading', { name: /^AI Settings$/i })).toBeVisible({ timeout: 5000 });
    // Fresh visit (no profiles seeded) shows the empty profile list.
    await expect(page.getByText(/no ai profiles yet/i)).toBeVisible();
  });
});
