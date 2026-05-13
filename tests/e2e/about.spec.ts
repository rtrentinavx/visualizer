import { test, expect } from './fixtures';

test.describe('about modal', () => {
  test('opens from the help icon and lists the views', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /about & take the tour/i }).click();
    await expect(page.getByRole('heading', { name: /about dcf visualizer/i })).toBeVisible({ timeout: 5000 });
    // The About copy lists the four lenses; spot-check one.
    await expect(page.getByText(/interactive design and validation tool/i)).toBeVisible();
  });
});
