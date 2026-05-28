import type {
  DcfPolicyModel,
  SmartGroup,
  WebGroup,
  ThreatGroup,
  GeoGroup,
  DcfPolicy,
  SmartGroupCriteria,
  Protocol,
} from '../../types/dcf';

/**
 * Maps the raw aggregated response from /api/aviatrix/topology-api into our
 * `DcfPolicyModel`. Handles two source formats:
 *
 *   v2.5 REST API (8.0+ controllers, preferred path):
 *     App-domains arrive pre-classified into smartGroups / webGroups /
 *     threatGroups / geoGroups by the proxy. Fields use the real API names:
 *       selector.any[].all   — flat key-value match expression
 *       src_ads / dst_ads    — source/destination app-domain UUID arrays
 *       web_filters          — L7 web-group UUID array
 *       port_ranges          — [{lo, hi}] objects
 *       decrypt_policy       — 'DECRYPT_ALLOWED' | 'DECRYPT_NOT_ALLOWED' | …
 *
 *   Legacy MCP / v2 action path (fallback):
 *     match_expressions / matchExpressions arrays with cidr / tags / type
 *     fields. src_smart_groups / dst_smart_groups / web_groups string arrays.
 *
 * Best-effort and tolerant of missing fields — unknowns default to safe
 * values rather than throwing.
 */
export interface RawAviatrixTopology {
  smartGroups: unknown[];
  webGroups: unknown[];
  threatGroups: unknown[];
  geoGroups: unknown[];
  policies: unknown[];
}

// Canonical UUIDs used by the controller for built-in pseudo-groups.
const ANY_UUID      = 'def000ad-0000-0000-0000-000000000000';
const INTERNET_UUID = 'def000ad-0000-0000-0000-000000000001';

const PALETTE = ['#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#10b981'];

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickArray(obj: Record<string, unknown>, ...keys: string[]): unknown[] | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

function firstString(arr: unknown[] | undefined): string | undefined {
  if (!arr) return undefined;
  for (const v of arr) if (typeof v === 'string') return v;
  return undefined;
}

function stableId(prefix: string, obj: Record<string, unknown>, fallbackIndex: number): string {
  const id = pickString(obj, 'uuid', 'id', 'ID', 'Uuid');
  return id ?? `${prefix}-${fallbackIndex}`;
}

/**
 * Remap controller-side special UUIDs to our canonical pseudo-group IDs.
 * Other UUIDs pass through unchanged.
 */
function remapGroupId(uuid: string | undefined): string | undefined {
  if (!uuid) return undefined;
  if (uuid === ANY_UUID) return 'sg-any';
  if (uuid === INTERNET_UUID) return 'sg-internet';
  return uuid;
}

// ---------------------------------------------------------------------------
// SmartGroup
// ---------------------------------------------------------------------------

function mapSmartGroup(raw: unknown, index: number): SmartGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rawId = stableId('sg', o, index);

  // Remap well-known system UUIDs to canonical IDs so mapTopology's dedup
  // check works correctly and policies that reference them resolve cleanly.
  const id = remapGroupId(rawId) ?? rawId;
  if (id === 'sg-any')      return { id, name: 'Any',      color: '#9ca3af', criteria: [], matchType: 'any' };
  if (id === 'sg-internet') return { id, name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' };

  const name = pickString(o, 'name', 'displayName', 'display_name') ?? `SmartGroup ${index + 1}`;
  const criteria: SmartGroupCriteria[] = [];

  // v2.5 REST path — selector.any[].all flat key-value map
  const selectorAny = asArray((o['selector'] as Record<string, unknown> | undefined)?.['any']);

  if (selectorAny.length > 0) {
    for (const expr of selectorAny) {
      if (!expr || typeof expr !== 'object') continue;
      const all = (expr as Record<string, unknown>)['all'];
      if (!all || typeof all !== 'object') continue;
      const allMap = all as Record<string, string>;

      const cidr = allMap['cidr'];
      if (cidr) { criteria.push({ type: 'subnet', cidr }); continue; }

      const type = allMap['type'];
      const resName = allMap['name'] ?? allMap['account_name'] ?? allMap['res_id'];
      if (type) {
        criteria.push({ type: 'vm', key: type, operator: 'equals', value: resName ?? '' });
        continue;
      }

      // Generic key-value pairs — skip fields that belong to geo/threat/web classification
      for (const [k, v] of Object.entries(allMap)) {
        if (k === 'external' || k === 'country_iso_code' || k === 'severity') continue;
        if (k === 'snifilter' || k === 'urlfilter') continue;
        if (typeof v === 'string') criteria.push({ type: 'vm', key: k, operator: 'equals', value: v });
      }
    }
  } else {
    // Legacy path — MCP server / old v2 response
    const matchExprs = pickArray(o, 'matchExpressions', 'match_expressions') ?? collectNestedMatchExprs(o);
    for (const me of matchExprs) {
      if (!me || typeof me !== 'object') continue;
      const m = me as Record<string, unknown>;
      const cidr = pickString(m, 'cidr');
      if (cidr) { criteria.push({ type: 'subnet', cidr }); continue; }

      const tags = m['tags'];
      if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
        for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
          if (typeof v === 'string') criteria.push({ type: 'vm', key: k, operator: 'equals', value: v });
        }
        continue;
      }

      const type = pickString(m, 'type', 'resourceType', 'resource_type');
      if (type) {
        const value = pickString(m, 'name', 'account_name', 'accountName', 'region', 'res_id', 'fqdn');
        if (value !== undefined) criteria.push({ type: 'vm', key: type, operator: 'equals', value });
      }
    }
  }

  return { id, name, color: colorFor(index), criteria, matchType: 'any' };
}

// ---------------------------------------------------------------------------
// WebGroup
// ---------------------------------------------------------------------------

function mapWebGroup(raw: unknown, index: number): WebGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = stableId('wg', o, index);
  const name = pickString(o, 'name', 'displayName', 'display_name') ?? `WebGroup ${index + 1}`;
  const fqdns: string[] = [];

  const selectorAny = asArray((o['selector'] as Record<string, unknown> | undefined)?.['any']);

  if (selectorAny.length > 0) {
    // v2.5 REST path — selector.any[].all.snifilter / urlfilter
    for (const expr of selectorAny) {
      if (!expr || typeof expr !== 'object') continue;
      const all = (expr as Record<string, unknown>)['all'] as Record<string, string> | undefined;
      if (!all) continue;
      const sni = all['snifilter'];
      const url = all['urlfilter'];
      if (sni) fqdns.push(sni);
      if (url) fqdns.push(url);
    }
  } else {
    // Legacy path
    const directFqdns = pickArray(o, 'fqdns', 'fqdn_list', 'fqdnList');
    if (directFqdns) for (const f of directFqdns) if (typeof f === 'string') fqdns.push(f);

    const matchExprs = pickArray(o, 'matchExpressions', 'match_expressions') ?? collectNestedMatchExprs(o);
    for (const me of matchExprs) {
      if (!me || typeof me !== 'object') continue;
      const m = me as Record<string, unknown>;
      const sni = pickString(m, 'snifilter', 'sni');
      const url = pickString(m, 'urlfilter', 'url');
      const fqdn = pickString(m, 'fqdn');
      if (sni) fqdns.push(sni);
      if (url) fqdns.push(url);
      if (fqdn) fqdns.push(fqdn);
    }
  }

  return { id, name, fqdns };
}

// ---------------------------------------------------------------------------
// ThreatGroup
// ---------------------------------------------------------------------------

function mapThreatGroup(raw: unknown, index: number): ThreatGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  // v2.5: derive category from selector.any[].all.external
  let category: ThreatGroup['category'] = 'custom';
  const selectorAny = asArray((o['selector'] as Record<string, unknown> | undefined)?.['any']);
  if (selectorAny.length > 0) {
    const firstExpr = selectorAny[0];
    if (firstExpr && typeof firstExpr === 'object') {
      const all = (firstExpr as Record<string, unknown>)['all'] as Record<string, string> | undefined;
      const ext = all?.['external'];
      if (ext === 'threatiq') category = 'malware';
    }
  } else {
    category = (pickString(o, 'category', 'kind') ?? 'custom') as ThreatGroup['category'];
  }

  return {
    id: stableId('tg', o, index),
    name: pickString(o, 'name', 'displayName', 'display_name') ?? `ThreatGroup ${index + 1}`,
    category,
    entryCount: asNumber(o['entryCount'] ?? o['entry_count'] ?? o['count']) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// GeoGroup
// ---------------------------------------------------------------------------

function mapGeoGroup(raw: unknown, index: number): GeoGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const selectorAny = asArray((o['selector'] as Record<string, unknown> | undefined)?.['any']);
  const countries: string[] = [];

  if (selectorAny.length > 0) {
    // v2.5: extract country_iso_code from each selector clause
    for (const expr of selectorAny) {
      if (!expr || typeof expr !== 'object') continue;
      const all = (expr as Record<string, unknown>)['all'] as Record<string, string> | undefined;
      const cc = all?.['country_iso_code'];
      if (cc) countries.push(cc);
    }
  } else {
    // Legacy path
    const legacyCountries = pickArray(o, 'countries', 'country_codes', 'countryCodes') ?? [];
    for (const c of legacyCountries) if (typeof c === 'string') countries.push(c);
  }

  return {
    id: stableId('gg', o, index),
    name: pickString(o, 'name', 'displayName', 'display_name') ?? `GeoGroup ${index + 1}`,
    countries,
  };
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

function mapPolicy(raw: unknown, index: number): DcfPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  // Action — map IDS/IPS variants to 'allow'
  const actionRaw = (pickString(o, 'action') ?? 'DENY').toUpperCase();
  const action: DcfPolicy['action'] =
    actionRaw === 'PERMIT' || actionRaw === 'ALLOW' ? 'allow'
    : actionRaw.startsWith('INTRUSION') ? 'allow'
    : actionRaw === 'LEARNED' ? 'learned'
    : 'deny';

  // Protocol — strip PROTOCOL_ prefix and _UNSPECIFIED suffix
  const protoRaw = (pickString(o, 'protocol') ?? '').toLowerCase()
    .replace('protocol_', '').replace('_unspecified', '') || 'any';
  const protocol: Protocol = (['tcp', 'udp', 'icmp', 'any'].includes(protoRaw) ? protoRaw : 'any') as Protocol;

  // Source / destination — v2.5 uses src_ads/dst_ads; legacy uses srcSmartGroups/etc.
  const srcAds = pickArray(o, 'src_ads', 'srcAds', 'src_smart_groups', 'srcSmartGroups') ?? [];
  const dstAds = pickArray(o, 'dst_ads', 'dstAds', 'dst_smart_groups', 'dstSmartGroups') ?? [];
  const src = remapGroupId(firstString(srcAds as unknown[]));
  const dst = remapGroupId(firstString(dstAds as unknown[]));

  // Exclude groups (legacy only — not exposed in v2.5 individually)
  const srcExcl = (pickArray(o, 'srcExcludeSmartGroups', 'src_exclude_smart_groups') ?? [])
    .filter((s): s is string => typeof s === 'string');
  const dstExcl = (pickArray(o, 'dstExcludeSmartGroups', 'dst_exclude_smart_groups') ?? [])
    .filter((s): s is string => typeof s === 'string');

  // Web filters — v2.5: web_filters; legacy: webGroups/web_groups
  const webFiltersRaw = pickArray(o, 'web_filters', 'webFilters', 'webGroups', 'web_groups') ?? [];
  const webGroupIds = webFiltersRaw
    .filter((s): s is string => typeof s === 'string')
    .map(remapGroupId)
    .filter((s): s is string => s !== undefined);

  // Port ranges — v2.5: [{lo, hi}] objects; legacy: strings like "443" or "8080-8090"
  const portRangesRaw = pickArray(o, 'port_ranges', 'portRanges') ?? [];
  const portParts: string[] = [];
  for (const pr of portRangesRaw) {
    if (typeof pr === 'string') { portParts.push(pr); continue; }
    if (pr && typeof pr === 'object') {
      const lo = (pr as Record<string, unknown>)['lo'];
      const hi = (pr as Record<string, unknown>)['hi'];
      if (lo !== undefined && hi !== undefined) {
        portParts.push(lo === hi ? String(lo) : `${lo}-${hi}`);
      }
    }
  }
  const ports = portParts.length > 0 ? portParts.join(',') : undefined;

  // Decrypt — v2.5: decrypt_policy field; legacy: decrypt boolean
  const decryptRaw = pickString(o, 'decrypt_policy', 'decryptPolicy');
  const decrypt = o['decrypt'] === true
    || decryptRaw === 'DECRYPT_ALLOWED'
    || decryptRaw === 'DECRYPT_REQUIRED'; // legacy value used by some older controllers

  return {
    id: stableId('pol', o, index),
    name: pickString(o, 'name') ?? `Policy ${index + 1}`,
    priority: asNumber(o['priority']) ?? 100 + index,
    srcGroupId: src ?? 'sg-any',
    dstGroupId: dst ?? 'sg-any',
    srcExcludeGroupIds: srcExcl.length > 0 ? srcExcl : undefined,
    dstExcludeGroupIds: dstExcl.length > 0 ? dstExcl : undefined,
    webGroupIds: webGroupIds.length > 0 ? webGroupIds : undefined,
    threatGroup: pickString(o, 'threatGroup', 'threat_group'),
    geoGroup: pickString(o, 'geoGroup', 'geo_group'),
    action,
    protocol,
    ports,
    logging: o['logging'] === true,
    decrypt,
    enforcement: o['enforcement'] !== false,
    policyListUuid: pickString(o, '_dcf_policy_list_uuid'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk one level into a `selector` block to find match_expressions arrays.
 * Used only for the legacy MCP / v2 response format.
 */
function collectNestedMatchExprs(o: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const sel = o['selector'] ?? o['selectors'];
  const selectors = Array.isArray(sel) ? sel : sel ? [sel] : [];
  for (const s of selectors) {
    if (!s || typeof s !== 'object') continue;
    const meKey = (s as Record<string, unknown>)['match_expressions']
      ?? (s as Record<string, unknown>)['matchExpressions'];
    if (Array.isArray(meKey)) out.push(...meKey);
    else if (meKey && typeof meKey === 'object') out.push(meKey);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

const INTERNET: SmartGroup = { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' };
const ANY: SmartGroup      = { id: 'sg-any',      name: 'Any',      color: '#9ca3af', criteria: [], matchType: 'any' };

/**
 * Map the proxy's raw payload into a complete DcfPolicyModel.
 * Returns `{ topology, droppedCounts }` so the UI can surface partial failures.
 */
export function mapTopology(raw: RawAviatrixTopology): {
  topology: DcfPolicyModel;
  droppedCounts: Record<keyof RawAviatrixTopology, number>;
} {
  const smartGroups: SmartGroup[] = [];
  const webGroups: WebGroup[] = [];
  const threatGroups: ThreatGroup[] = [];
  const geoGroups: GeoGroup[] = [];
  const policies: DcfPolicy[] = [];
  const droppedCounts = { smartGroups: 0, webGroups: 0, threatGroups: 0, geoGroups: 0, policies: 0 };

  asArray(raw.smartGroups).forEach((r, i) => {
    const mapped = mapSmartGroup(r, i);
    if (mapped) smartGroups.push(mapped); else droppedCounts.smartGroups++;
  });
  asArray(raw.webGroups).forEach((r, i) => {
    const mapped = mapWebGroup(r, i);
    if (mapped) webGroups.push(mapped); else droppedCounts.webGroups++;
  });
  asArray(raw.threatGroups).forEach((r, i) => {
    const mapped = mapThreatGroup(r, i);
    if (mapped) threatGroups.push(mapped); else droppedCounts.threatGroups++;
  });
  asArray(raw.geoGroups).forEach((r, i) => {
    const mapped = mapGeoGroup(r, i);
    if (mapped) geoGroups.push(mapped); else droppedCounts.geoGroups++;
  });
  asArray(raw.policies).forEach((r, i) => {
    const mapped = mapPolicy(r, i);
    if (mapped) policies.push(mapped); else droppedCounts.policies++;
  });

  // Ensure the two pseudo-groups always exist — the evaluator, simulator, and
  // graph view all reference these by literal ID.
  if (!smartGroups.some((g) => g.id === 'sg-any')) smartGroups.unshift(ANY);
  if (!smartGroups.some((g) => g.id === 'sg-internet')) smartGroups.unshift(INTERNET);

  return {
    topology: { smartGroups, webGroups, threatGroups, geoGroups, policies, flows: [] },
    droppedCounts,
  };
}
