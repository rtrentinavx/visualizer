import { test, expect } from './fixtures';

test.describe('header layout', () => {
  test('stays on a single line at the default viewport (regression: pre-Bcc8ea1 it wrapped)', async ({ page }) => {
    await page.goto('/');
    // The Tailwind `h-14` class on the header element is fixed (56px). If the
    // toolbar contents overflow, they get a horizontal scrollbar inside the
    // toolbar — the header itself does NOT grow taller. Verify height.
    const header = page.locator('header, [class*="border-b"]').filter({ has: page.getByRole('img', { name: 'DCF Visualizer' }) }).first();
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // h-14 = 56px. Allow a 2px slop for border/sub-pixel rounding.
    expect(box!.height).toBeLessThanOrEqual(58);
    expect(box!.height).toBeGreaterThanOrEqual(54);
  });
});
