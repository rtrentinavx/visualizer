import { test, expect } from './fixtures';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const POLICY_LIST_UUID = 'aabbccdd-1234-5678-abcd-000000000001';
const POLICY_UUID      = 'aabbccdd-1234-5678-abcd-000000000002';
const SG_WEB_UUID      = 'aabbccdd-1234-5678-abcd-000000000003';
const SG_DB_UUID       = 'aabbccdd-1234-5678-abcd-000000000004';

/**
 * Minimal topology with one imported policy (has policyListUuid) and
 * UUID-keyed SmartGroups. Stored as a plain-JSON string so useTopology's
 * plain-JSON fallback picks it up without decryption.
 */
const TEST_TOPOLOGY = JSON.stringify({
  smartGroups: [
    { id: 'sg-any',      name: 'Any',         color: '#9ca3af', criteria: [], matchType: 'any' },
    { id: 'sg-internet', name: 'Internet',     color: '#ef4444', criteria: [], matchType: 'any' },
    { id: SG_WEB_UUID,   name: 'Web Servers',  color: '#3b82f6', criteria: [{ type: 'subnet', cidr: '10.0.1.0/24' }], matchType: 'any' },
    { id: SG_DB_UUID,    name: 'Databases',    color: '#22c55e', criteria: [{ type: 'subnet', cidr: '10.0.2.0/24' }], matchType: 'any' },
  ],
  webGroups: [],
  threatGroups: [],
  geoGroups: [],
  policies: [{
    id: POLICY_UUID,
    name: 'Web to DB allow',
    priority: 100,
    srcGroupId: SG_WEB_UUID,
    dstGroupId: SG_DB_UUID,
    action: 'allow',
    protocol: 'tcp',
    ports: '5432',
    logging: false,
    enforcement: true,
    policyListUuid: POLICY_LIST_UUID,
  }],
  flows: [],
});

/**
 * API connection stored as plain JSON — loadAviatrixSettings() has a
 * plain-JSON fallback (for pre-encryption migration) that we exploit here.
 */
const API_CONNECTION = JSON.stringify({
  activeConnectionId: 'test-api-conn',
  connections: [{
    id: 'test-api-conn',
    name: 'Test Controller',
    connectionType: 'api',
    controllerBaseUrl: 'https://fake-controller.test',
    username: 'admin',
    password: 'test-password',
    connectedAt: 1748000000000,
  }],
});

/**
 * Build a topology-api stub response. Pass 'PERMIT' to produce no diff with
 * the local topology (local action = 'allow'), 'DENY' to produce one.
 */
function makeCtrlTopologyResponse(policyAction: 'PERMIT' | 'DENY') {
  return {
    raw: {
      smartGroups: [
        { uuid: SG_WEB_UUID, name: 'Web Servers', selector: { any: [{ all: { cidr: '10.0.1.0/24' } }] } },
        { uuid: SG_DB_UUID,  name: 'Databases',   selector: { any: [{ all: { cidr: '10.0.2.0/24' } }] } },
      ],
      webGroups: [],
      threatGroups: [],
      geoGroups: [],
      policies: [{
        uuid: POLICY_UUID,
        name: 'Web to DB allow',
        priority: 100,
        src_ads: [SG_WEB_UUID],
        dst_ads: [SG_DB_UUID],
        action: policyAction,
        protocol: 'TCP',
        port_ranges: [{ lo: 5432, hi: 5432 }],
        logging: false,
        enforcement: true,
        _dcf_policy_list_uuid: POLICY_LIST_UUID,
      }],
    },
    policyLists: [{ uuid: POLICY_LIST_UUID, name: 'Test PolicyList' }],
    apiVersion: 'v2.5',
    warnings: [],
  };
}

/** Inject test topology + API connection into localStorage before page load. */
async function injectConnection(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ({ topo, conn }: { topo: string; conn: string }) => {
      localStorage.setItem('dcf-topology-v1', topo);
      localStorage.setItem('dcf-aviatrix-settings-v1', conn);
      // Pre-unlock achievements so demo-topology load doesn't fire toasters
      // that would sit on top of the modal buttons and intercept clicks.
      const ach: Record<string, string> = {};
      ['first-policy', 'first-group', 'ten-policies', 'evaluator-perfect-score']
        .forEach((id) => { ach[id] = new Date().toISOString(); });
      localStorage.setItem('dcf-achievements-v1', JSON.stringify(ach));
    },
    { topo: TEST_TOPOLOGY, conn: API_CONNECTION },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('push to controller', () => {

  test('push button appears in the toolbar when an API connection is configured', async ({ page }) => {
    await injectConnection(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });

    // The button is rendered by AppHeader once activeApiConnection is set.
    await expect(
      page.getByRole('button', { name: 'Push changes to controller' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('modal shows loading state then "no changes detected" when controller matches local', async ({ page }) => {
    await injectConnection(page);

    await page.route('**/api/aviatrix/topology-api', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeCtrlTopologyResponse('PERMIT')),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Push changes to controller' }).click();

    await expect(page.getByRole('heading', { name: /push to controller/i })).toBeVisible({ timeout: 5000 });

    // After topology-api responds, diff shows "no changes"
    await expect(page.getByText(/no changes detected/i)).toBeVisible({ timeout: 8000 });

    // Push button in footer is disabled when there is nothing to push
    await expect(page.getByRole('button', { name: /nothing to push/i })).toBeDisabled();
  });

  test('happy path: diff shows changed policy, push succeeds, re-syncs topology', async ({ page }) => {
    await injectConnection(page);

    // Count topology-api calls to verify the re-sync after push
    let topologyApiCalls = 0;
    await page.route('**/api/aviatrix/topology-api', async (route) => {
      topologyApiCalls++;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeCtrlTopologyResponse('DENY')),
      });
    });

    await page.route('**/api/aviatrix/push-topology', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyListsPushed: 1,
          policiesUpdated: 1,
          smartGroupsUpdated: 0,
          smartGroupsCreated: 0,
          warnings: [],
          errors: [],
          deployed: true,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /policy evaluator/i }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Push changes to controller' }).click();

    await expect(page.getByRole('heading', { name: /push to controller/i })).toBeVisible({ timeout: 5000 });

    // Diff loads — 1 policy changed (local allow vs controller DENY)
    await expect(page.getByText(/1 policy changed/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('action')).toBeVisible();

    // Footer button reflects the single changed policy
    const pushBtn = page.getByRole('button', { name: /push 1 change/i });
    await expect(pushBtn).toBeEnabled();
    await pushBtn.click();

    // Success state
    await expect(page.getByText(/push successful/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/1 policy updated/i)).toBeVisible();

    // topology-api must have been called twice: once for the diff, once for re-sync
    expect(topologyApiCalls).toBe(2);
  });

});
