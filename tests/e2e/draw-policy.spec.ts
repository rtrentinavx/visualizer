import { test, expect } from './fixtures';

test.describe('draw policy in Graph view', () => {
  // Regression seed for the long-standing "first node click does nothing"
  // bug. Root cause: handleMouseDown called e.preventDefault() in unlocked
  // layout mode, which suppresses the synthetic click event on SVG nodes →
  // handleNodeClick never fired. Fix in PolicyGraph.tsx skips the drag
  // initiator when connectMode is true. Removing this .fixme prefix locks
  // the fix in.
  test('click Draw Policy → click two nodes → inspector opens with new policy', async ({ page }) => {
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

    // Inspector should show the "New Policy" form. The label sits in a div,
    // not a heading element, so we match by text.
    await expect(page.getByText(/^new policy$/i)).toBeVisible({ timeout: 3000 });
  });

  // Regression seed for the actual user-reported manifestation: in UNLOCKED
  // layout mode, the bug was deterministic (mousedown calls preventDefault,
  // suppresses synthetic click). The fix in PolicyGraph.tsx makes
  // handleMouseDown a no-op when connectMode is true so the click flows
  // through regardless of lock state.
  test('works when the layout is unlocked (drag mode)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({ timeout: 5000 });

    // Unlock the layout first — this is the state where preventDefault on
    // mousedown was suppressing the click.
    await page.getByRole('button', { name: /^locked$/i }).click();
    await expect(page.getByRole('button', { name: /^unlocked$/i })).toBeVisible();

    await page.getByRole('button', { name: /draw policy/i }).click();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();

    const nodes = page.locator('svg g').filter({ has: page.locator('circle[r="28"]') });
    await nodes.first().click();
    await nodes.nth(1).click();

    await expect(page.getByText(/^new policy$/i)).toBeVisible({ timeout: 3000 });
  });
});
