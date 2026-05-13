import { test, expect } from './fixtures';

test.describe('app loads', () => {
  test('renders the header and the Matrix tab by default', async ({ page }) => {
    await page.goto('/');
    // The header has the visualizer mascot + view tabs.
    await expect(page.getByRole('img', { name: 'DCF Visualizer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Matrix' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Traffic' })).toBeVisible();
    // Matrix is the default landing view; the page title says "POLICY MATRIX".
    await expect(page.getByRole('heading', { name: /policy matrix/i })).toBeVisible();
  });
});
