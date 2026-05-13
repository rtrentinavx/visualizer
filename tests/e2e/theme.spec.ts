import { test, expect } from './fixtures';

test.describe('theme toggle', () => {
  test('flips between light and dark on click', async ({ page }) => {
    await page.goto('/');

    // Probe the initial theme by reading the `data-theme` attribute on <html>
    // (the useTheme hook sets it). Either light or dark is acceptable as a
    // starting state — what matters is that a click flips it.
    const html = page.locator('html');
    const initial = await html.getAttribute('data-theme');
    expect(initial).toMatch(/^(light|dark)$/);

    // The toggle button label encodes the *target* theme:
    //   "Switch to light mode" when currently dark, vice versa.
    const target = initial === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', { name: new RegExp(`Switch to ${target} mode`) }).click();

    await expect(html).toHaveAttribute('data-theme', target);
  });
});
