import { test, expect } from './fixtures';

test.describe('draw policy in Graph view', () => {
  test('click Draw Policy → click two nodes → inspector opens with new policy', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({ timeout: 5000 });

    // Enter connect mode.
    await page.getByRole('button', { name: /draw policy/i }).click();
    // Button should now read "Cancel".
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();

    // Enter connect mode first, then the DOM overlay appears
    const nodes = page.locator('[data-testid^="fg-node-"]');
    await expect(nodes.first()).toBeVisible({ timeout: 5000 });
    const count = await nodes.count();
    if (count < 2) {
      test.skip();
      return;
    }
    await nodes.first().click();
    await nodes.nth(1).click();

    // Inspector should show the "New Policy" form.
    await expect(page.getByText(/^new policy$/i)).toBeVisible({ timeout: 3000 });
  });

  test('works when the layout is unlocked (drag mode)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({ timeout: 5000 });

    // The new React Flow graph has no lock/unlock toggle — drag is always available.
    // Just verify draw-policy mode still works.
    await page.getByRole('button', { name: /draw policy/i }).click();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();

    // Enter connect mode first, then the DOM overlay appears
    const nodes = page.locator('[data-testid^="fg-node-"]');
    await expect(nodes.first()).toBeVisible({ timeout: 5000 });
    const count = await nodes.count();
    if (count < 2) {
      test.skip();
      return;
    }
    await nodes.first().click();
    await nodes.nth(1).click();

    await expect(page.getByText(/^new policy$/i)).toBeVisible({ timeout: 3000 });
  });
});
