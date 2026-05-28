import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import http from 'http';
import type { DcfPolicy } from '../../src/types/dcf.js';

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
}

export interface PushResult {
  policyListsPushed: number;
  policiesUpdated: number;
  warnings: string[];
  errors: string[];
  deployed: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Request body must be JSON.' });

  const { controllerBaseUrl, username, password, policies } = req.body as PushRequest;
  if (!controllerBaseUrl || !username || !password) {
    return res.status(400).json({ error: 'Missing controllerBaseUrl, username, or password.' });
  }
  if (!isHttpUrl(controllerBaseUrl)) {
    return res.status(400).json({ error: 'controllerBaseUrl must be an http(s) URL.' });
  }
  if (!Array.isArray(policies) || policies.length === 0) {
    return res.status(400).json({ error: 'No policies to push.' });
  }

  const base = controllerBaseUrl.replace(/\/$/, '');
  const result: PushResult = { policyListsPushed: 0, policiesUpdated: 0, warnings: [], errors: [], deployed: false };

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
  const pushable = policies.filter((p) => p.policyListUuid);
  if (pushable.length === 0) {
    return res.status(200).json({ ...result, warnings: ['No policies have a controller origin — nothing to push. Import from a live controller first.'] });
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
    const newPolicies = rawPolicies.map((rawPolicy) => {
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
        src_ads: [mapBackId(local.srcGroupId)],
        dst_ads: [mapBackId(local.dstGroupId)],
        port_ranges: parsePorts(local.ports),
        decrypt_policy: local.decrypt ? 'DECRYPT_ALLOWED' : 'DECRYPT_NOT_ALLOWED',
        logging: local.logging,
        web_filters: local.webGroupIds ?? rp['web_filters'] ?? [],
        enforcement: local.enforcement !== false,
      };

      // Protocol: controller rejects every "any" variant (PROTOCOL_ANY_UNSPECIFIED,
      // ANY, etc.) on write. Omitting the field entirely defaults to any-protocol.
      // For specific protocols the stripped uppercase form (TCP/UDP/ICMP) is accepted.
      if (local.protocol !== 'any') {
        merged['protocol'] = local.protocol.toUpperCase();
      } else {
        delete merged['protocol'];
      }

      return merged;
    });

    if (updatedCount === 0) {
      // Nothing in this PolicyList actually changed — skip the PUT.
      continue;
    }

    const putBody: Record<string, unknown> = { policies: newPolicies };
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

  // Step 5 — deploy (only when at least one PolicyList was updated successfully).
  // Try v2.5 REST first; fall back to v2 form-encoded action if it rejects the body.
  if (result.policyListsPushed > 0) {
    try {
      let deployR = await controllerFetch(
        `${base}/v2.5/api/microseg/deploy-policy`,
        {
          method: 'POST',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({}),
        },
        20_000,
      );

      // v2.5 rejects body in some controller versions — fall back to v2 form-encoded
      if (!deployR.ok && deployR.status === 400) {
        const params = new URLSearchParams({ action: 'deploy_distributed_firewalling_policy', CID: cid });
        deployR = await controllerFetch(`${base}/v2/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        }, 20_000);
      }

      result.deployed = deployR.ok;
      if (!deployR.ok) {
        const errText = await deployR.text().catch(() => '');
        result.warnings.push(`Deploy returned HTTP ${deployR.status} — ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      result.warnings.push(`Deploy step failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return res.status(200).json(result);
}
