import { test, expect } from './fixtures';

test.describe('draw policy in Graph view', () => {
  // KNOWN BUG: user reported "first node click does nothing" in commit 8e31f2b
  // (since reverted, with the underlying bug still unresolved). This is a
  // regression-seed test that documents the expected behavior; once the bug
  // is fixed, remove the .fixme() prefix to lock in the fix.
  test.fixme('click Draw Policy → click two nodes → inspector opens with new policy', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({ timeout: 5000 });

    // Enter connect mode.
    await page.getByRole('button', { name: /draw policy/i }).click();
    // Button should now read "Cancel".
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();

    // Click first node — should show the blue glow ring (animated dashed
    // circle around the node). We don't assert the visual; just that a
    // second click on a different node opens the inspector with a new
    // policy form.
    const nodes = page.locator('svg g').filter({ has: page.locator('circle[r="28"]') });
    await nodes.first().click();
    await nodes.nth(1).click();

    // Inspector should show "New Policy" form.
    await expect(page.getByRole('heading', { name: /new policy/i })).toBeVisible({ timeout: 3000 });
  });
});
