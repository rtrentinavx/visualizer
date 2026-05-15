import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithTimeout, isTimeoutError } from '../ai/_timeout.js';

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

const V1_ACTIONS: Record<EntityKey, string> = {
  smartGroups: 'list_smart_group_info',
  webGroups: 'list_fqdn_filter_tags',
  threatGroups: 'list_threat_groups',
  geoGroups: 'list_geo_groups',
  policies: 'list_distributed_firewalling_policy_list',
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
        return res.status(200).json({ raw: emptyRaw(), apiVersion: 'v2.5', warnings });
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
      return res.status(200).json({ raw: emptyRaw(), apiVersion: 'v1', warnings });
    }

    const raw = emptyRaw();
    for (const key of Object.keys(V1_ACTIONS) as EntityKey[]) {
      try {
        const data = await callV1(base, cid, V1_ACTIONS[key]);
        raw[key] = toArray(data);
      } catch (e) {
        warnings.push(`v1 ${key} (action=${V1_ACTIONS[key]}) failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    return res.status(200).json({ raw, apiVersion: 'v1', warnings });

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
  const r = await fetchWithTimeout(`${base}/v2.5/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  const body = await r.json() as Record<string, unknown>;
  const token = body['access_token'] ?? body['accessToken'] ?? body['token'];
  if (typeof token !== 'string' || !token) {
    throw new Error('v2.5 login response missing access_token');
  }
  return token;
}

async function getV25(base: string, token: string, path: string): Promise<unknown> {
  const r = await fetchWithTimeout(`${base}${path}`, {
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
  const r = await fetchWithTimeout(`${base}/v1/api`, {
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

async function callV1(base: string, cid: string, action: string): Promise<unknown> {
  const params = new URLSearchParams({ action, CID: cid });
  const r = await fetchWithTimeout(`${base}/v1/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
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

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
