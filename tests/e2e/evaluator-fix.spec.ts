import { test, expect } from './fixtures';

test.describe('evaluator deterministic Fix it for me', () => {
  // Regression seed for the user-reported "clicking Fix it for me does
  // nothing" symptom. The fix it actually depends on is shadow-detector
  // skipping disabled policies (in policyEvaluator.ts) so that after the
  // click disables a policy, the next evaluation pass removes the finding
  // from the visible list. Without that filter, the click works at the
  // data-model level but the panel keeps showing the same finding, which
  // looks identical to "did nothing" from the user's perspective.
  test('clicking Fix it for me reduces the fixable count', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /policy evaluator/i }).first().click();
    await expect(page.getByText(/compliance score/i)).toBeVisible({ timeout: 5000 });

    const summaryLine = page.locator('p.text-xs').filter({ hasText: /fixable$/ }).first();
    const before = parseInt(((await summaryLine.textContent()) ?? '').match(/(\d+)\s+fixable/)?.[1] ?? '0', 10);
    test.skip(before === 0, 'no fixable findings in demo — nothing to assert');

    await page.getByRole('button', { name: /fix it for me/i }).first().click();
    await page.waitForTimeout(500);

    const after = parseInt(((await summaryLine.textContent()) ?? '').match(/(\d+)\s+fixable/)?.[1] ?? '0', 10);
    expect(after).toBeLessThan(before);
  });
});
