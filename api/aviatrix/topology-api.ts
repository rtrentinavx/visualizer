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

const V25_PATHS: Record<EntityKey, string> = {
  smartGroups: '/v2.5/api/smart-groups',
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
// SmartGroups are internally called "App Domains" in some controller versions.
// Keep the candidate list short — each call costs a round-trip.  We use a
// 6-second per-call timeout during scanning (see the entity loop below) so
// that probing all candidates for all entities finishes well within Vercel's
// 60-second function limit.
const V1_ACTIONS: Record<EntityKey, string[]> = {
  smartGroups:  ['list_app_domain', 'list_smart_group', 'list_smart_groups', 'list_smart_group_info', 'get_smart_group'],
  webGroups:    ['list_fqdn_filter_tags', 'get_fqdn_filter_tag'],
  threatGroups: ['list_threat_iq_lists', 'list_threat_iq_group', 'list_threat_groups', 'get_threat_iq_list'],
  geoGroups:    ['list_geo_groups', 'list_geo_group', 'list_geo_fqdn_filter_tags', 'get_geo_group'],
  policies:     ['list_distributed_firewalling_policy', 'list_dcf_policy', 'get_dcf_policy', 'list_distributed_firewalling_policy_list'],
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

    // -----------------------------------------------------------------------
    // 1. Try v2.5
    // -----------------------------------------------------------------------
    let v25Token: string | null = null;
    try {
      v25Token = await loginV25(base, username, password);
    } catch (e) {
      warnings.push(`v2.5 login failed (${e instanceof Error ? e.message : 'unknown'}); trying v1.`);
    }

    if (v25Token !== null) {
      if (testOnly) {
        return res.status(200).json({ raw: emptyRaw(), apiVersion: 'v2.5', egressIp: await fetchEgressIp(), warnings });
      }
      const raw = emptyRaw();
      for (const key of Object.keys(V25_PATHS) as EntityKey[]) {
        try {
          const data = await getV25(base, v25Token, V25_PATHS[key]);
          raw[key] = toArray(data);
        } catch (e) {
          warnings.push(`v2.5 ${key} fetch failed: ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
      return res.status(200).json({ raw, apiVersion: 'v2.5', warnings });
    }

    // -----------------------------------------------------------------------
    // 2. Fall back to v1
    // -----------------------------------------------------------------------
    let cid: string;
    try {
      cid = await loginV1(base, username, password);
    } catch (e) {
      if (isTimeoutError(e)) {
        return res.status(504).json({ error: 'Controller did not respond within the timeout.' });
      }
      return res.status(502).json({ error: `Authentication failed: ${e instanceof Error ? e.message : 'unknown'}` });
    }

    if (testOnly) {
      return res.status(200).json({ raw: emptyRaw(), apiVersion: 'v1', egressIp: await fetchEgressIp(), warnings });
    }

    // -----------------------------------------------------------------------
    // 3. Try v2.5 endpoints using the v1 CID as a Bearer token.
    // Controllers that reject username/password on the v2.5 login endpoint
    // (returning 400) often accept the v1 session CID as a Bearer token on
    // v2.5 data endpoints — the OAuth flow issues the same kind of session
    // token under the hood.
    // -----------------------------------------------------------------------
    const raw = emptyRaw();
    let usedV25WithCid = false;
    {
      const v25Failures: string[] = [];
      for (const key of Object.keys(V25_PATHS) as EntityKey[]) {
        try {
          const data = await getV25(base, cid, V25_PATHS[key]);
          raw[key] = toArray(data);
        } catch (e) {
          v25Failures.push(key);
        }
      }
      // If at least one v2.5 endpoint succeeded, report as v2.5+CID.
      if (v25Failures.length < Object.keys(V25_PATHS).length) {
        usedV25WithCid = true;
        if (v25Failures.length > 0) {
          warnings.push(`v2.5-with-CID partial: ${v25Failures.join(', ')} not available`);
        }
      }
    }

    if (!usedV25WithCid) {
      // v2.5 with CID also failed — fall back to v1 action scanning for each entity.
      for (const key of Object.keys(V1_ACTIONS) as EntityKey[]) {
        const candidates = V1_ACTIONS[key];
        let succeeded = false;
        for (const action of candidates) {
          try {
            // Use a short timeout for action-scanning so probing all candidates
            // for all entities stays well within Vercel's 60-second limit.
            const data = await callV1(base, cid, action, 6_000);
            raw[key] = toArray(data);
            succeeded = true;
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown';
            if (msg.toLowerCase().includes('valid action') || msg.toLowerCase().includes('invalid action')) continue;
            warnings.push(`v1 ${key} (action=${action}) failed: ${msg}`);
            succeeded = true;
            break;
          }
        }
        if (!succeeded) {
          warnings.push(`v1 ${key}: DCF action not available (tried ${candidates.length} candidates)`);
        }
      }
    }

    const apiVersion = usedV25WithCid ? 'v2.5 (CID auth)' : 'v1';
    return res.status(200).json({ raw, apiVersion, warnings });

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

async function loginV25(base: string, username: string, password: string): Promise<string> {
  // Try JSON body first (standard v2.5 format), then fall back to form-encoded
  // (some older v2.5 implementations reject JSON login requests).
  for (const attempt of [
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' } as Record<string, string>,
      body: JSON.stringify({ username, password }),
    },
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } as Record<string, string>,
      body: new URLSearchParams({ username, password }).toString(),
    },
  ]) {
    const r = await controllerFetch(`${base}/v2.5/api/login`, {
      method: 'POST',
      headers: attempt.headers,
      body: attempt.body,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      // 404/405 → endpoint doesn't exist; 400/401 → wrong format, try next
      if (r.status === 404 || r.status === 405) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      continue;
    }
    const body = await r.json() as Record<string, unknown>;
    const token = body['access_token'] ?? body['accessToken'] ?? body['token'];
    if (typeof token === 'string' && token) return token;
  }
  throw new Error('v2.5 login failed — bad credentials or unsupported format');
}

async function getV25(base: string, token: string, path: string): Promise<unknown> {
  const r = await controllerFetch(`${base}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// ---------------------------------------------------------------------------
// v1 helpers
// ---------------------------------------------------------------------------

async function loginV1(base: string, username: string, password: string): Promise<string> {
  const params = new URLSearchParams({ action: 'login', username, password });
  const r = await controllerFetch(`${base}/v1/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  const body = await r.json() as Record<string, unknown>;
  if (body['return'] !== true) {
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'login rejected';
    throw new Error(reason);
  }
  const cid = body['CID'];
  if (typeof cid !== 'string' || !cid) {
    throw new Error('v1 login response missing CID');
  }
  return cid;
}

async function callV1(base: string, cid: string, action: string, timeoutMs = 22_000): Promise<unknown> {
  const params = new URLSearchParams({ action, CID: cid });
  const r = await controllerFetch(`${base}/v1/api`, {
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
  // v1 wraps results in { results: [...] }
  return body['results'] ?? body;
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

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
