import { test, expect } from './fixtures';

test.describe('simulator endpoint combobox (regression: 10a34a1)', () => {
  test('typing a valid CIDR clears the red error border and enables Run', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Traffic' }).click();

    const src = page.getByPlaceholder(/10\.0\.1\.5 or 10\.0\.0\.0\/16/);
    const dst = page.getByPlaceholder(/10\.0\.2\.10 or 10\.0\.0\.0\/16/);

    // Bad input: red border + error text.
    await src.fill('not-an-ip');
    await expect(page.getByText(/not a valid ipv4 address or cidr/i)).toBeVisible();

    // Recover with a CIDR — error disappears.
    await src.fill('10.0.0.0/16');
    await expect(page.getByText(/not a valid ipv4 address or cidr/i)).not.toBeVisible();

    // Fill dst and click Run — verdict should render.
    await dst.fill('192.168.0.0/24');
    await page.getByRole('button', { name: /run simulation/i }).click();
    await expect(page.getByText(/^(ALLOWED|DENIED|IMPLICIT DENY|LEARNED)$/)).toBeVisible({ timeout: 5000 });
  });

  test('picking a SmartGroup from the dropdown flips the input into chip mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Traffic' }).click();

    // Open the source dropdown via the chevron next to the text input.
    const src = page.getByPlaceholder(/10\.0\.1\.5 or 10\.0\.0\.0\/16/);
    await src.click(); // focus opens the dropdown
    // The dropdown shows SmartGroup names (demo topology includes "Web Tier").
    const webTier = page.getByRole('option', { name: /web tier/i }).first();
    await expect(webTier).toBeVisible({ timeout: 3000 });
    await webTier.click();

    // After picking: input is replaced by a "SmartGroup" chip with the name.
    // The chip contains the kind label "SmartGroup" and the group name.
    await expect(page.getByText(/^SmartGroup$/).first()).toBeVisible();
    await expect(page.getByText(/web tier/i).first()).toBeVisible();
    // And the text input is gone (chip mode renders a different shape).
    await expect(src).not.toBeVisible();
  });
});
