import { test, expect } from './fixtures';

test.describe('Policy Graph (3D force-directed)', () => {
  test('graph heading renders', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('action filter buttons toggle aria-pressed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({
      timeout: 5000,
    });

    const allowBtn = page.getByRole('button', { name: 'Allow' });
    await allowBtn.click();
    await expect(allowBtn).toHaveAttribute('aria-pressed', 'true');

    const denyBtn = page.getByRole('button', { name: 'Deny' });
    await denyBtn.click();
    await expect(denyBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(allowBtn).toHaveAttribute('aria-pressed', 'false');

    const allBtn = page.getByRole('button', { name: 'All', exact: true });
    await allBtn.click();
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('draw-policy mode overlay appears', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole('button', { name: /draw policy/i }).click();
    await expect(page.getByText(/click the source node/i)).toBeVisible({ timeout: 3000 });
  });

  test('fit view button does not throw', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole('button', { name: /fit graph to viewport/i }).click();
    // Heading still visible — no uncaught error crashed the page
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible();
  });

  test('posture mode toggle changes button state', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph' }).click();
    await expect(page.getByRole('heading', { name: /policy graph/i })).toBeVisible({
      timeout: 5000,
    });

    const postureBtn = page.getByRole('button', { name: /enable posture mode/i });
    await expect(postureBtn).toBeVisible();
    await postureBtn.click();
    await expect(
      page.getByRole('button', { name: /posture mode on/i }),
    ).toBeVisible({ timeout: 2000 });
  });
});
