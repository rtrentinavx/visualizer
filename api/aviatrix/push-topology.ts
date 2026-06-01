import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import http from 'http';
import type { DcfPolicy, SmartGroup } from '../../src/types/dcf.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isControllerUuid(id: string): boolean { return UUID_RE.test(id); }

function buildAppDomainBody(sg: SmartGroup): Record<string, unknown> {
  const selectorAny = sg.criteria
    .map((c) => {
      if (c.type === 'subnet' && c.cidr) return { all: { cidr: c.cidr } };
      if (c.type === 'vm' && c.key) return { all: { [c.key]: c.value ?? '' } };
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  return { name: sg.name, selector: { any: selectorAny } };
}

export const config = { maxDuration: 60 };

// Canonical pseudo-group IDs → controller UUIDs
const ANY_UUID      = 'def000ad-0000-0000-0000-000000000000';
const INTERNET_UUID = 'def000ad-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Minimal controllerFetch (duplicated from topology-api to keep the file
// self-contained — no shared runtime module exists yet for serverless fns).
// ---------------------------------------------------------------------------

interface SimpleResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function controllerFetch(url: string, init: RequestInit, timeoutMs = 22_000): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isSecure = u.protocol === 'https:';
    const mod = isSecure ? https : http;
    const body = typeof init.body === 'string' ? init.body : undefined;
    const port = u.port ? parseInt(u.port, 10) : (isSecure ? 443 : 80);

    const req = mod.request(
      {
        hostname: u.hostname,
        port,
        path: u.pathname + (u.search || ''),
        method: (init.method ?? 'GET').toUpperCase(),
        headers: init.headers as Record<string, string>,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          });
        });
        res.on('error', reject);
      },
    );

    req.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? '';
      if (code === 'ECONNREFUSED') reject(new Error(`Connection refused (${u.host})`));
      else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') reject(new Error(`Connection timed out (${u.host})`));
      else if (code === 'ENOTFOUND') reject(new Error(`Host not found: ${u.hostname}`));
      else reject(new Error(err.message || 'Network error'));
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)));
    if (body) req.write(body);
    req.end();
  });
}

async function loginV2(base: string, username: string, password: string): Promise<string> {
  for (const apiPath of ['/v2/api', '/v1/api']) {
    const params = new URLSearchParams({ action: 'login', username, password });
    try {
      const r = await controllerFetch(`${base}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!r.ok) continue;
      const body = await r.json() as Record<string, unknown>;
      if (body['return'] !== true) continue;
      const cid = body['CID'];
      if (typeof cid === 'string' && cid) return cid;
    } catch { /* try next path */ }
  }
  throw new Error('Login failed on both /v2/api and /v1/api');
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// DcfPolicy → controller raw policy (spread-merge target).
// This only sets fields we understand; the caller spreads the raw original
// first so unknown/unmodelled fields are preserved.
// ---------------------------------------------------------------------------

function mapBackId(localId: string): string {
  if (localId === 'sg-any')      return ANY_UUID;
  if (localId === 'sg-internet') return INTERNET_UUID;
  return localId;
}


function parsePorts(ports: string | undefined): Array<{ lo: number; hi: number }> {
  if (!ports) return [];
  return ports.split(',').flatMap((part) => {
    const t = part.trim();
    const dash = t.indexOf('-');
    if (dash > 0) {
      const lo = parseInt(t.slice(0, dash), 10);
      const hi = parseInt(t.slice(dash + 1), 10);
      if (!isNaN(lo) && !isNaN(hi)) return [{ lo, hi }];
    }
    const n = parseInt(t, 10);
    if (!isNaN(n)) return [{ lo: n, hi: n }];
    return [];
  });
}

interface PushRequest {
  controllerBaseUrl: string;
  username: string;
  password: string;
  policies: DcfPolicy[];
  newPolicies?: DcfPolicy[];
  targetPolicyListUuid?: string;
  smartGroups?: SmartGroup[];
  smartGroupsToDelete?: string[];
}

export interface PushResult {
  policyListsPushed: number;
  policiesUpdated: number;
  smartGroupsUpdated: number;
  smartGroupsCreated: number;
  smartGroupsDeleted: number;
  warnings: string[];
  errors: string[];
  deployed: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Request body must be JSON.' });

  const { controllerBaseUrl, username, password, policies, newPolicies, targetPolicyListUuid, smartGroups, smartGroupsToDelete } = req.body as PushRequest;
  if (!controllerBaseUrl || !username || !password) {
    return res.status(400).json({ error: 'Missing controllerBaseUrl, username, or password.' });
  }
  if (!isHttpUrl(controllerBaseUrl)) {
    return res.status(400).json({ error: 'controllerBaseUrl must be an http(s) URL.' });
  }
  const hasExistingEdits = Array.isArray(policies) && policies.length > 0;
  const hasNewPolicies = Array.isArray(newPolicies) && newPolicies.length > 0;
  const hasSmartGroups = Array.isArray(smartGroups) && smartGroups.length > 0;
  const hasSmartGroupDeletes = Array.isArray(smartGroupsToDelete) && smartGroupsToDelete.length > 0;
  if (!hasExistingEdits && !hasNewPolicies && !hasSmartGroups && !hasSmartGroupDeletes) {
    return res.status(400).json({ error: 'No changes to push.' });
  }

  const base = controllerBaseUrl.replace(/\/$/, '');
  const result: PushResult = { policyListsPushed: 0, policiesUpdated: 0, smartGroupsUpdated: 0, smartGroupsCreated: 0, smartGroupsDeleted: 0, warnings: [], errors: [], deployed: false };

  // Step 1 — authenticate
  let cid: string;
  try {
    cid = await loginV2(base, username, password);
  } catch (e) {
    return res.status(502).json({ error: `Authentication failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
  const authHeader = `cid ${cid}`;

  // Step 2 — re-fetch current policy-list3 for drift detection + raw body
  let rawPolicyLists: unknown[];
  try {
    const r = await controllerFetch(
      `${base}/v2.5/api/microseg/policy-list3`,
      { method: 'GET', headers: { Authorization: authHeader, Accept: 'application/json' } },
      15_000,
    );
    if (!r.ok) {
      return res.status(502).json({ error: `Controller returned HTTP ${r.status} for policy-list3` });
    }
    const body = await r.json() as Record<string, unknown>;
    rawPolicyLists = asArray(body['dcf_policies']);
  } catch (e) {
    return res.status(502).json({ error: `Failed to fetch current policies: ${e instanceof Error ? e.message : 'unknown'}` });
  }

  // Step 3 — group local policies by policyListUuid (skip policies without one)
  const pushable = (hasExistingEdits ? policies : []).filter((p) => p.policyListUuid);
  if (pushable.length === 0 && !hasNewPolicies) {
    return res.status(200).json({ ...result, warnings: ['No policies have a controller origin — nothing to push. Import from a live controller first.'] });
  }
  if (hasNewPolicies && !targetPolicyListUuid) {
    return res.status(400).json({ error: 'targetPolicyListUuid is required when pushing new policies.' });
  }

  const byPolicyList = new Map<string, DcfPolicy[]>();
  for (const p of pushable) {
    const plId = p.policyListUuid!;
    const arr = byPolicyList.get(plId) ?? [];
    arr.push(p);
    byPolicyList.set(plId, arr);
  }

  // Step 4 — for each affected PolicyList: merge local changes, PUT
  const plMap = new Map<string, Record<string, unknown>>();
  for (const rawPL of rawPolicyLists) {
    if (rawPL && typeof rawPL === 'object') {
      const o = rawPL as Record<string, unknown>;
      if (typeof o['uuid'] === 'string') plMap.set(o['uuid'], o);
    }
  }

  for (const [plUuid, localPolicies] of byPolicyList) {
    const rawPL = plMap.get(plUuid);
    if (!rawPL) {
      result.warnings.push(`PolicyList ${plUuid} not found on controller (may have been deleted)`);
      continue;
    }

    const localById = new Map(localPolicies.map((p) => [p.id, p]));
    let updatedCount = 0;

    const rawPolicies = asArray(rawPL['policies']);
    const mergedPolicies = rawPolicies.map((rawPolicy) => {
      if (!rawPolicy || typeof rawPolicy !== 'object') return rawPolicy;
      const rp = rawPolicy as Record<string, unknown>;
      if (rp['system_resource']) return rp; // never touch system-managed entries

      const polUuid = typeof rp['uuid'] === 'string' ? rp['uuid'] : undefined;
      if (!polUuid) return rp;

      const local = localById.get(polUuid);
      if (!local) return rp; // policy not edited locally — pass through unchanged

      // Guard: if the controller policy has multiple src or dst ADs, our model
      // lost siblings on import — overwriting with a single ID would be destructive.
      const srcAds = asArray(rp['src_ads']);
      const dstAds = asArray(rp['dst_ads']);
      if (srcAds.length > 1 || dstAds.length > 1) {
        result.warnings.push(`Policy "${local.name}" skipped: controller policy has multiple src/dst app-domains (not supported in push V1)`);
        return rp;
      }

      updatedCount++;
      // Spread the raw policy first to preserve any fields we don't model,
      // then override only the fields we understand.
      const merged: Record<string, unknown> = {
        ...rp,
        name: local.name,
        priority: local.priority,
        action: local.action === 'allow' ? 'PERMIT' : 'DENY',
        src_ads: local.srcGroupId.map(mapBackId),
        dst_ads: local.dstGroupId.map(mapBackId),
        port_ranges: parsePorts(local.ports),
        decrypt_policy: local.decrypt ? 'DECRYPT_ALLOWED' : 'DECRYPT_NOT_ALLOWED',
        logging: local.logging,
        web_filters: local.webGroupIds ?? rp['web_filters'] ?? [],
        enforcement: local.enforcement !== false,
      };

      // Protocol: controller (8.x) rejects every known "any" representation
      // (PROTOCOL_ANY_UNSPECIFIED, ANY, omitted) on write with AVXERR-DFW-0003/0004,
      // even though it sends PROTOCOL_ANY_UNSPECIFIED on GET. Skip such policies
      // rather than failing the entire PolicyList PUT.
      if (local.protocol === 'any') {
        result.warnings.push(`Policy "${local.name}" skipped: protocol 'any' cannot be written to this controller version (known limitation)`);
        updatedCount--; // undo the increment — this policy won't be changed
        return rp;      // return the unchanged raw policy
      }
      merged['protocol'] = local.protocol.toUpperCase(); // TCP, UDP, ICMP

      return merged;
    });

    if (updatedCount === 0) {
      // Nothing in this PolicyList actually changed — skip the PUT.
      continue;
    }

    const putBody: Record<string, unknown> = { policies: mergedPolicies };
    if (typeof rawPL['name'] === 'string') putBody['name'] = rawPL['name'];

    try {
      const putR = await controllerFetch(
        `${base}/v2.5/api/microseg/policy-list3/${plUuid}`,
        {
          method: 'PUT',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(putBody),
        },
        15_000,
      );
      if (putR.ok) {
        result.policyListsPushed++;
        result.policiesUpdated += updatedCount;
      } else {
        const errText = await putR.text().catch(() => '');
        result.errors.push(`PolicyList "${rawPL['name'] ?? plUuid}": PUT returned HTTP ${putR.status} — ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      result.errors.push(`PolicyList "${rawPL['name'] ?? plUuid}": ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  // Step 5 — append new (locally-created) policies to the target PolicyList.
  if (hasNewPolicies && targetPolicyListUuid) {
    const targetPL = plMap.get(targetPolicyListUuid);
    if (!targetPL) {
      result.errors.push(`Target PolicyList ${targetPolicyListUuid} not found on controller`);
    } else {
      const existingPolicies = asArray(targetPL['policies']);
      const builtNewPolicies = (newPolicies as DcfPolicy[]).filter((p) => p.protocol !== 'any').map((p) => {
        if (p.protocol === 'any') return null; // filtered above, but for safety
        return {
          name: p.name,
          priority: p.priority,
          action: p.action === 'allow' ? 'PERMIT' : 'DENY',
          src_ads: p.srcGroupId.map(mapBackId),
          dst_ads: p.dstGroupId.map(mapBackId),
          port_ranges: parsePorts(p.ports),
          protocol: p.protocol.toUpperCase(),
          logging: p.logging,
          enforcement: p.enforcement !== false,
          decrypt_policy: p.decrypt ? 'DECRYPT_ALLOWED' : 'DECRYPT_NOT_ALLOWED',
          web_filters: p.webGroupIds ?? [],
        };
      }).filter(Boolean);

      const anySkipped = (newPolicies as DcfPolicy[]).filter((p) => p.protocol === 'any');
      for (const p of anySkipped) {
        result.warnings.push(`New policy "${p.name}" skipped: protocol 'any' cannot be written to this controller version (known limitation)`);
      }

      if (builtNewPolicies.length > 0) {
        const putBody: Record<string, unknown> = {
          policies: [...existingPolicies, ...builtNewPolicies],
        };
        if (typeof targetPL['name'] === 'string') putBody['name'] = targetPL['name'];

        try {
          const putR = await controllerFetch(
            `${base}/v2.5/api/microseg/policy-list3/${targetPolicyListUuid}`,
            {
              method: 'PUT',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(putBody),
            },
            15_000,
          );
          if (putR.ok) {
            result.policyListsPushed++;
            result.policiesUpdated += builtNewPolicies.length;
          } else {
            const errText = await putR.text().catch(() => '');
            result.errors.push(`New policies → PolicyList "${targetPL['name'] ?? targetPolicyListUuid}": PUT returned HTTP ${putR.status} — ${errText.slice(0, 200)}`);
          }
        } catch (e) {
          result.errors.push(`New policies → PolicyList "${targetPL['name'] ?? targetPolicyListUuid}": ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
    }
  }

  // Step 6 — SmartGroup creates and updates.
  if (hasSmartGroups) {
    for (const sg of (smartGroups as SmartGroup[])) {
      if (sg.id === 'sg-any' || sg.id === 'sg-internet') continue;
      const body = buildAppDomainBody(sg);

      if (isControllerUuid(sg.id)) {
        try {
          const putR = await controllerFetch(
            `${base}/v2.5/api/app-domains/${sg.id}`,
            {
              method: 'PUT',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(body),
            },
            10_000,
          );
          if (putR.ok) {
            result.smartGroupsUpdated++;
          } else {
            const errText = await putR.text().catch(() => '');
            result.errors.push(`SmartGroup "${sg.name}": PUT returned HTTP ${putR.status} — ${errText.slice(0, 200)}`);
          }
        } catch (e) {
          result.errors.push(`SmartGroup "${sg.name}": ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      } else {
        try {
          const postR = await controllerFetch(
            `${base}/v2.5/api/app-domains`,
            {
              method: 'POST',
              headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(body),
            },
            10_000,
          );
          if (postR.ok) {
            result.smartGroupsCreated++;
            result.warnings.push(`SmartGroup "${sg.name}" created. Re-import topology to get the controller-assigned UUID.`);
          } else {
            const errText = await postR.text().catch(() => '');
            result.errors.push(`SmartGroup "${sg.name}": POST returned HTTP ${postR.status} — ${errText.slice(0, 200)}`);
          }
        } catch (e) {
          result.errors.push(`SmartGroup "${sg.name}": ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
    }
  }

  // Step 7 — delete SmartGroups removed from the local topology.
  if (hasSmartGroupDeletes) {
    for (const uuid of (smartGroupsToDelete as string[])) {
      if (!isControllerUuid(uuid)) continue;
      try {
        const delR = await controllerFetch(
          `${base}/v2.5/api/app-domains/${uuid}`,
          { method: 'DELETE', headers: { Authorization: authHeader, Accept: 'application/json' } },
          10_000,
        );
        if (delR.ok) {
          result.smartGroupsDeleted++;
        } else {
          const errText = await delR.text().catch(() => '');
          result.errors.push(`SmartGroup delete ${uuid}: HTTP ${delR.status} — ${errText.slice(0, 200)}`);
        }
      } catch (e) {
        result.errors.push(`SmartGroup delete ${uuid}: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
  }

  // Step 8 — deploy (when at least one PolicyList or SmartGroup was changed).
  if (result.policyListsPushed > 0 || result.smartGroupsUpdated > 0 || result.smartGroupsCreated > 0 || result.smartGroupsDeleted > 0) {
    try {
      const deployBody = JSON.stringify({});
      const deployR = await controllerFetch(
        `${base}/v2.5/api/microseg/deploy-policy`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: deployBody,
        },
        20_000,
      );
      result.deployed = deployR.ok;
      if (!deployR.ok) {
        const errText = await deployR.text().catch(() => '');
        result.warnings.push(`Deploy returned HTTP ${deployR.status} — ${errText.slice(0, 200)}. Trigger a manual deploy from the Aviatrix controller if needed.`);
      }
    } catch (e) {
      result.warnings.push(`Deploy step failed: ${e instanceof Error ? e.message : 'unknown'}. Trigger a manual deploy from the Aviatrix controller if needed.`);
    }
  }

  return res.status(200).json(result);
}
