import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import http from 'http';
import { isTimeoutError } from '../ai/_timeout.js';

/**
 * Aviatrix controllers commonly expose self-signed TLS certificates (accessed
 * by IP or internal hostname). We use Node's https module directly with
 * rejectUnauthorized: false so the proxy can reach the controller. The
 * connection remains TLS-encrypted — we only skip certificate chain validation.
 */
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
      if (code === 'ECONNREFUSED') reject(new Error(`Connection refused — check the Controller URL and port (${u.host})`));
      else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') reject(new Error(`Connection timed out — is ${u.host} reachable from the internet and port ${port} open?`));
      else if (code === 'ENOTFOUND') reject(new Error(`Host not found: ${u.hostname}`));
      else reject(new Error(err.message || 'Network error'));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * Direct REST API proxy for live topology fetch from a customer's Aviatrix
 * Controller (8.0+).
 *
 * Auth flow (confirmed against 8.2 controller):
 *   1. POST /v2/api  action=login  (form-encoded) → { CID: "..." }
 *   2. All v2.5 GETs use  Authorization: cid <CID>
 *      (scheme "cid" is documented in the OpenAPI securitySchemes.SessionKey)
 *
 * Entity endpoints (v2.5):
 *   All groups unified  → GET /v2.5/api/app-domains
 *     Classified by selector.any[].all key set:
 *       snifilter|urlfilter       → webGroup
 *       external: geo             → geoGroup
 *       external: threatiq|ip2*   → threatGroup
 *       everything else           → smartGroup
 *   Policies            → GET /v2.5/api/microseg/policy-list3
 *     Flatten policies[] from each PolicyList, skip system_resource rules.
 *
 * Falls back to /v2/api action-scanning when v2.5 returns a non-2xx status.
 */

export const config = { maxDuration: 60 };

type EntityKey = 'smartGroups' | 'webGroups' | 'threatGroups' | 'geoGroups' | 'policies';

// Special controller-side UUIDs that map to our canonical pseudo-group IDs.
const ANY_UUID      = 'def000ad-0000-0000-0000-000000000000'; // 0.0.0.0/0 wildcard
const INTERNET_UUID = 'def000ad-0000-0000-0000-000000000001'; // public internet routes

// Threat-intelligence external source identifiers.
const THREAT_SOURCES = new Set(['threatiq', 'ip2location', 'maxmind', 'ipstack', 'ipinfo']);

// v2 action name candidates (fallback path only).
const V2_ACTIONS: Record<EntityKey, string[]> = {
  smartGroups:  [
    'list_smart_groups', 'list_smart_group', 'list_app_domain',
    'dcf_list_smart_groups', 'dcf_list_smart_group',
    'list_smart_group_info', 'get_smart_group',
  ],
  webGroups:    ['list_fqdn_filter_tags', 'get_fqdn_filter_tag'],
  threatGroups: [
    'list_threat_iq_lists', 'dcf_list_threat_groups',
    'list_threat_iq_group', 'list_threat_groups',
  ],
  geoGroups:    [
    'list_geo_groups', 'dcf_list_geo_groups',
    'list_geo_group', 'list_geo_fqdn_filter_tags',
  ],
  policies:     [
    'list_distributed_firewalling_policy_list',
    'dcf_list_policies', 'dcf_list_policy',
    'list_dcf_policy', 'get_dcf_policy',
    'list_distributed_firewalling_policy',
  ],
};

interface DirectApiRequest {
  controllerBaseUrl: string;
  username: string;
  password: string;
  testOnly?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body must be JSON.' });
    }

    const { controllerBaseUrl, username, password, testOnly } = req.body as DirectApiRequest;
    if (!controllerBaseUrl || !username || !password) {
      return res.status(400).json({ error: 'Missing controllerBaseUrl, username, or password.' });
    }
    if (!isHttpUrl(controllerBaseUrl)) {
      return res.status(400).json({ error: 'controllerBaseUrl must be an http(s) URL.' });
    }

    const base = controllerBaseUrl.replace(/\/$/, '');
    const warnings: string[] = [];

    // Step 1 — authenticate via /v2/api (works on all 8.x controllers).
    let cid: string;
    try {
      cid = await loginV2(base, username, password);
    } catch (e) {
      if (isTimeoutError(e)) {
        return res.status(504).json({ error: 'Controller did not respond within the timeout.' });
      }
      return res.status(502).json({ error: `Authentication failed: ${e instanceof Error ? e.message : 'unknown'}` });
    }

    if (testOnly) {
      return res.status(200).json({ raw: emptyRaw(), apiVersion: 'v2', egressIp: await fetchEgressIp(), warnings });
    }

    // Step 2 — try v2.5 REST endpoints (8.0+ auth: Authorization: cid <CID>).
    const v25Raw = await tryFetchV25(base, cid, warnings);
    if (v25Raw) {
      return res.status(200).json({ raw: v25Raw, apiVersion: 'v2.5', warnings });
    }

    // Step 3 — fall back to /v2/api action-scanning (older controllers or feature-gated DCF).
    warnings.push('v2.5 endpoints unavailable — falling back to /v2/api action scanning');
    const raw = emptyRaw();
    for (const key of Object.keys(V2_ACTIONS) as EntityKey[]) {
      const candidates = V2_ACTIONS[key];
      let succeeded = false;
      for (const action of candidates) {
        try {
          const data = await callV2Action(base, cid, action, 6_000);
          raw[key] = toArray(data);
          succeeded = true;
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'unknown';
          if (msg.toLowerCase().includes('valid action') || msg.toLowerCase().includes('invalid action')) continue;
          warnings.push(`${key} (action=${action}) failed: ${msg}`);
          succeeded = true;
          break;
        }
      }
      if (!succeeded) {
        warnings.push(`${key}: no matching action on /v2/api (tried: ${candidates.join(', ')})`);
      }
    }

    return res.status(200).json({ raw, apiVersion: 'v2', warnings });

  } catch (err) {
    console.error('[aviatrix/topology-api] outer error', err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: `Proxy error: ${message}` });
    }
  }
}

// ---------------------------------------------------------------------------
// v2.5 fetch path — Authorization: cid <CID>
// ---------------------------------------------------------------------------

/**
 * Try to fetch all topology data via the v2.5 REST API.
 * Returns the classified raw data on success, null when v2.5 is unavailable
 * (so the caller can fall back to v2 action scanning).
 */
async function tryFetchV25(
  base: string,
  cid: string,
  warnings: string[],
): Promise<Record<EntityKey, unknown[]> | null> {
  const authHeader = `cid ${cid}`;

  // --- App domains (all groups unified) ---
  let allAppDomains: unknown[];
  try {
    const r = await controllerFetch(
      `${base}/v2.5/api/app-domains`,
      { method: 'GET', headers: { Authorization: authHeader, Accept: 'application/json' } },
      15_000,
    );
    if (!r.ok) {
      warnings.push(`v2.5 app-domains returned HTTP ${r.status} — skipping v2.5 path`);
      return null;
    }
    const body = await r.json() as Record<string, unknown>;
    allAppDomains = asArray(body['app_domains']);
    if (allAppDomains.length === 0) {
      warnings.push('v2.5 app-domains returned an empty list');
    }
  } catch (e) {
    warnings.push(`v2.5 app-domains error: ${e instanceof Error ? e.message : 'unknown'}`);
    return null;
  }

  // Classify app-domains into the four entity buckets.
  // Per-country system groups (def05847-4300-*) are excluded — there are 250+
  // of them and they flood the model; user-defined geo groups (which combine
  // countries in their selector) are kept.
  const smartGroups: unknown[] = [];
  const webGroups: unknown[]   = [];
  const threatGroups: unknown[] = [];
  const geoGroups: unknown[]   = [];

  for (const ad of allAppDomains) {
    if (!shouldIncludeAppDomain(ad)) continue;
    switch (classifyAppDomain(ad)) {
      case 'web':    webGroups.push(ad); break;
      case 'geo':    geoGroups.push(ad); break;
      case 'threat': threatGroups.push(ad); break;
      default:       smartGroups.push(ad);
    }
  }

  // --- Policies ---
  let policies: unknown[] = [];
  try {
    const r = await controllerFetch(
      `${base}/v2.5/api/microseg/policy-list3`,
      { method: 'GET', headers: { Authorization: authHeader, Accept: 'application/json' } },
      15_000,
    );
    if (r.ok) {
      const body = await r.json() as Record<string, unknown>;
      policies = flattenPolicies(asArray(body['dcf_policies']));
    } else {
      warnings.push(`v2.5 policy-list3 returned HTTP ${r.status}`);
    }
  } catch (e) {
    warnings.push(`v2.5 policies error: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  return { smartGroups, webGroups, threatGroups, geoGroups, policies };
}

/**
 * Classify an app-domain by inspecting its selector.any[].all key set.
 * Called AFTER shouldIncludeAppDomain so we don't need to re-check system_resource.
 */
function classifyAppDomain(ad: unknown): 'smart' | 'web' | 'geo' | 'threat' {
  if (!ad || typeof ad !== 'object') return 'smart';
  const selector = (ad as Record<string, unknown>)['selector'] as Record<string, unknown> | undefined;
  for (const expr of asArray(selector?.['any'])) {
    if (!expr || typeof expr !== 'object') continue;
    const all = (expr as Record<string, unknown>)['all'] as Record<string, string> | undefined;
    if (!all) continue;
    if ('snifilter' in all || 'urlfilter' in all) return 'web';
    const ext = all['external'];
    if (ext === 'geo') return 'geo';
    if (THREAT_SOURCES.has(ext ?? '')) return 'threat';
  }
  return 'smart';
}

/**
 * Keep user-defined app-domains and the handful of well-known system resources
 * (wildcard Any, Internet, SNI wildcard). Drop per-country system geo entries
 * (def05847-4300-*) to avoid flooding the model with 250+ entries.
 */
function shouldIncludeAppDomain(ad: unknown): boolean {
  if (!ad || typeof ad !== 'object') return false;
  const o = ad as Record<string, unknown>;
  if (!o['system_resource']) return true;
  const uuid = typeof o['uuid'] === 'string' ? o['uuid'] : '';
  return uuid.startsWith('def000ad-');
}

/**
 * Walk dcf_policies (which can be PolicyLists or PolicyBlocks) and collect
 * all user-defined rule entries from PolicyList.policies arrays.
 * Each policy is tagged with _dcf_policy_list_uuid so the push path can
 * address the correct parent PolicyList when writing back to the controller.
 */
function flattenPolicies(dcfPolicies: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const obj of dcfPolicies) {
    if (!obj || typeof obj !== 'object') continue;
    const plObj = obj as Record<string, unknown>;
    const plUuid = typeof plObj['uuid'] === 'string' ? plObj['uuid'] : undefined;
    const polList = plObj['policies'];
    if (!Array.isArray(polList)) continue;
    for (const p of polList) {
      if (p && typeof p === 'object' && !(p as Record<string, unknown>)['system_resource']) {
        out.push(plUuid ? Object.assign({}, p as object, { _dcf_policy_list_uuid: plUuid }) : p);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// v2 helpers (login + action scanning — fallback path)
// ---------------------------------------------------------------------------

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
    } catch {
      // try next path
    }
  }
  throw new Error('Login failed on both /v2/api and /v1/api');
}

async function callV2Action(base: string, cid: string, action: string, timeoutMs = 22_000): Promise<unknown> {
  for (const apiPath of ['/v2/api', '/v1/api']) {
    const params = new URLSearchParams({ action, CID: cid });
    try {
      const r = await controllerFetch(`${base}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      }, timeoutMs);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
      }
      const body = await r.json() as Record<string, unknown>;
      if (body['return'] === false) {
        const reason = typeof body['reason'] === 'string' ? body['reason'] : 'action failed';
        throw new Error(reason);
      }
      return body['results'] ?? body;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.toLowerCase().includes('valid action') && apiPath === '/v2/api') continue;
      throw e;
    }
  }
  throw new Error('Valid action required');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function emptyRaw(): Record<EntityKey, unknown[]> {
  return { smartGroups: [], webGroups: [], threatGroups: [], geoGroups: [], policies: [] };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const k of ['items', 'data', 'results', 'value', 'list']) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

async function fetchEgressIp(): Promise<string | null> {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const { ip } = await r.json() as { ip?: string };
    return typeof ip === 'string' ? ip : null;
  } catch {
    return null;
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Export for testing
export { ANY_UUID, INTERNET_UUID, classifyAppDomain, flattenPolicies, shouldIncludeAppDomain };
