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
      // Surface the system error code so users can diagnose firewall/port issues.
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
 * Controller. Tries the v2.5 REST API first (JSON Bearer auth); falls back to
 * the v1 CID-based API when v2.5 is unavailable or returns 404/405.
 *
 * Request body:
 *   { controllerBaseUrl: string, username: string, password: string, testOnly?: boolean }
 *
 * Response (same shape as /api/aviatrix/topology):
 *   {
 *     raw: { smartGroups, webGroups, threatGroups, geoGroups, policies },
 *     apiVersion: 'v2.5' | 'v1',
 *     warnings: string[],
 *   }
 *
 * When testOnly=true the proxy only authenticates and returns immediately —
 * no entity fetches are performed.
 *
 * Endpoint name assumptions (easily adjusted here if the controller uses
 * different paths/actions):
 *
 *   v2.5 paths (relative to controllerBaseUrl):
 *     login          → POST /v2.5/api/login
 *     smartGroups    → GET  /v2.5/api/smart-groups
 *     webGroups      → GET  /v2.5/api/web-groups
 *     threatGroups   → GET  /v2.5/api/threat-groups
 *     geoGroups      → GET  /v2.5/api/geo-groups
 *     policies       → GET  /v2.5/api/distributed-firewalling/policies
 *
 *   v1 actions (all via POST /v1/api):
 *     login          → action=login
 *     smartGroups    → action=list_smart_group_info
 *     webGroups      → action=list_fqdn_filter_tags
 *     threatGroups   → action=list_threat_groups
 *     geoGroups      → action=list_geo_groups
 *     policies       → action=list_distributed_firewalling_policy_list
 */

export const config = { maxDuration: 60 };

type EntityKey = 'smartGroups' | 'webGroups' | 'threatGroups' | 'geoGroups' | 'policies';

// Smart groups are "app-domains" in the v2.5 REST API (confirmed from
// goaviatrix/smart_group.go which calls PostAPIContext25("app-domains")).
const V25_PATHS: Record<EntityKey, string> = {
  smartGroups: '/v2.5/api/app-domains',
  webGroups: '/v2.5/api/web-groups',
  threatGroups: '/v2.5/api/threat-groups',
  geoGroups: '/v2.5/api/geo-groups',
  policies: '/v2.5/api/distributed-firewalling/policies',
};

/**
 * Ordered candidate action names per entity. The proxy tries each in sequence
 * and uses the first that doesn't return "Valid action required". This handles
 * variation across Controller versions without hard-coding a single name.
 */
// Action names for POST /v2/api. DCF-related features use a dcf_ prefix
// matching the controller feature flags (dcf_multi_policies, k8s_dcf_policies).
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

    // Login via /v2/api (confirmed correct endpoint per controller Terraform).
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

    const raw = emptyRaw();
    for (const key of Object.keys(V2_ACTIONS) as EntityKey[]) {
      const candidates = V2_ACTIONS[key];
      let succeeded = false;
      for (const action of candidates) {
        try {
          const data = await callApi(base, cid, action, 6_000);
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
// v2.5 helpers
// ---------------------------------------------------------------------------

/**
 * v2.5 login — two-step flow used by the Aviatrix Go client:
 *   1. GET /v2/api?action=get_api_token  (no auth) → { api_token: "..." }
 *   2. POST /v2.5/api/login  with X-Access-Key: <api_token>  → { access_token: "..." }
 *
 * Falls back to plain JSON login without the header in case the controller
 * version doesn't require the pre-token step.
 */
/**
 * v2.5 login — mirrors the goaviatrix two-step flow:
 *   1. POST /v2/api  action=get_api_token  (no CID)  → { api_token }
 *   2. POST /v2.5/api/login  body={username,password}  header X-Access-Key: <api_token>
 *      → { access_token }
 *
 * Also tries without the pre-token in case the controller version skips step 1.
 */
async function loginV25(base: string, username: string, password: string): Promise<string> {
  // Step 1 — get the pre-auth API token (POST action, no CID required).
  let apiToken: string | undefined;
  try {
    const params = new URLSearchParams({ action: 'get_api_token' });
    const r = await controllerFetch(`${base}/v2/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params.toString(),
    }, 8_000);
    if (r.ok) {
      const body = await r.json() as Record<string, unknown>;
      const t = (body as Record<string, Record<string, unknown>>)['results']?.['api_token']
        ?? body['api_token'] ?? body['apiToken'];
      if (typeof t === 'string' && t) apiToken = t;
    }
  } catch { /* not fatal */ }

  // Step 2 — POST credentials with X-Access-Key header (and fallback without).
  for (const token of apiToken ? [apiToken, undefined] : [undefined]) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers['X-Access-Key'] = token;

    try {
      const r = await controllerFetch(`${base}/v2.5/api/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, password }),
      }, 10_000);
      if (!r.ok) continue;
      const body = await r.json() as Record<string, unknown>;
      const access = body['access_token'] ?? body['accessToken'] ?? body['token'];
      if (typeof access === 'string' && access) return access;
    } catch { /* try next */ }
  }
  throw new Error('v2.5 login failed');
}

/**
 * Probe a v2.5 endpoint trying several auth formats in sequence.
 * Returns the first successful response, or the last failure details.
 */
async function probeV25Auth(
  base: string,
  cid: string,
  path: string,
): Promise<{ ok: boolean; status: number; scheme: string }> {
  const schemes: Array<{ label: string; headers: Record<string, string>; url?: string }> = [
    // Standard Bearer (JWT) — may fail if CID isn't a valid JWT.
    { label: 'Bearer', headers: { Authorization: `Bearer ${cid}`, Accept: 'application/json' } },
    // Aviatrix-specific CID scheme used by some controller versions.
    { label: 'CID-header', headers: { Authorization: `CID ${cid}`, Accept: 'application/json' } },
    // CID as a query parameter — used by some internal/older v2.5 implementations.
    { label: 'CID-query', headers: { Accept: 'application/json' }, url: `${base}${path}?CID=${encodeURIComponent(cid)}` },
  ];
  let lastStatus = 0;
  for (const s of schemes) {
    const url = s.url ?? `${base}${path}`;
    try {
      const r = await controllerFetch(url, { method: 'GET', headers: s.headers }, 8_000);
      if (r.ok) return { ok: true, status: r.status, scheme: s.label };
      lastStatus = r.status;
    } catch {
      // network error — try next scheme
    }
  }
  return { ok: false, status: lastStatus, scheme: 'none' };
}

async function getV25(base: string, token: string, path: string): Promise<unknown> {
  return getV25WithScheme(base, token, path, 'Bearer');
}

async function getV25WithScheme(base: string, cid: string, path: string, scheme: string): Promise<unknown> {
  const url = scheme === 'CID-query'
    ? `${base}${path}?CID=${encodeURIComponent(cid)}`
    : `${base}${path}`;
  const authHeader = scheme === 'Bearer'
    ? `Bearer ${cid}`
    : scheme === 'CID-header'
      ? `CID ${cid}`
      : undefined;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;

  const r = await controllerFetch(url, { method: 'GET', headers });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// v2 helpers  (POST /v2/api — the correct endpoint per controller Terraform)
// ---------------------------------------------------------------------------

async function loginV2(base: string, username: string, password: string): Promise<string> {
  // Try /v2/api first (confirmed correct by controller Terraform provisioners),
  // then fall back to /v1/api for older installs.
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

async function callApi(base: string, cid: string, action: string, timeoutMs = 22_000): Promise<unknown> {
  // Try /v2/api first — it supports DCF actions that /v1/api doesn't.
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
      // "Valid action required" on /v2/api → try /v1/api
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

/**
 * Pull a list out of an opaque response. Tolerant of common wrapping shapes:
 * array, { items }, { data }, { results }, { list }, first array-valued field.
 */
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

/** Reflect the outbound IP of THIS function invocation — used so the UI can show the exact IP the customer must allow-list. */
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

/**
 * Try known API introspection actions. If any succeeds and the response
 * contains action names that look DCF-related, return them as a string
 * (for the caller to surface in warnings). Returns null if no discovery
 * endpoint is available.
 */
async function discoverActions(base: string, cid: string): Promise<string | null> {
  const discoveryActions = ['list_actions', 'get_actions', 'list_api_actions', 'get_api_list'];
  for (const action of discoveryActions) {
    try {
      const data = await callApi(base, cid, action, 6_000) as unknown;
      const text = JSON.stringify(data);
      // Extract action names that look DCF/smartgroup/firewalling related.
      const matches = (text.match(/"[^"]*(?:smart_group|firewalling|dcf|threat|geo_group)[^"]*"/gi) ?? [])
        .map((s) => s.replace(/"/g, ''))
        .slice(0, 20);
      if (matches.length > 0) return matches.join(', ');
      // Return first 200 chars of the raw response so we can see the structure.
      return `(action=${action} succeeded but no DCF entries found) raw: ${text.slice(0, 200)}`;
    } catch {
      // not a valid action — try next
    }
  }
  return null;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
