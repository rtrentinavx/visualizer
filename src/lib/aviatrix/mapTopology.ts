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
 * Maps the raw aggregated response from /api/aviatrix/topology (which is
 * itself the MCP server's response, lightly normalized) into our
 * `DcfPolicyModel`. Best-effort and tolerant of missing fields — the MCP
 * server's exact schema is the variable we're least confident about, so
 * unknowns default to safe values rather than throwing.
 *
 * Key wins vs the HCL-import path:
 * - UUIDs come straight from the controller, so policy → web_groups
 *   linkage works without a .tfstate file.
 * - Tag-based SmartGroups land with their tag criteria intact (HCL import
 *   loses tags when they're emitted via `tags = { ... }` maps).
 */
export interface RawAviatrixTopology {
  smartGroups: unknown[];
  webGroups: unknown[];
  threatGroups: unknown[];
  geoGroups: unknown[];
  policies: unknown[];
}

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

/**
 * Build a stable id for a resource — prefer the server-issued UUID, fall
 * back to a synthesized one using the entity prefix + index so different
 * collections don't collide.
 */
function stableId(prefix: string, obj: Record<string, unknown>, fallbackIndex: number): string {
  const id = pickString(obj, 'uuid', 'id', 'ID', 'Uuid');
  return id ?? `${prefix}-${fallbackIndex}`;
}

function mapSmartGroup(raw: unknown, index: number): SmartGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = stableId('sg', o, index);
  const name = pickString(o, 'name', 'displayName', 'display_name') ?? `SmartGroup ${index + 1}`;

  // Selector / criteria. The controller's shape is typically nested:
  //   { selector: { match_expressions: [ { type, name, cidr, tags } ] } }
  // We're tolerant: pull from common paths.
  const matchExprs = pickArray(o, 'matchExpressions', 'match_expressions') ?? collectNestedMatchExprs(o);
  const criteria: SmartGroupCriteria[] = [];
  for (const me of matchExprs) {
    if (!me || typeof me !== 'object') continue;
    const m = me as Record<string, unknown>;
    const cidr = pickString(m, 'cidr');
    if (cidr) { criteria.push({ type: 'subnet', cidr }); continue; }

    const tags = m['tags'];
    if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
      for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
        if (typeof v === 'string') {
          criteria.push({ type: 'vm', key: k, operator: 'equals', value: v });
        }
      }
      continue;
    }

    // Resource-type matcher (vpc, account, region, k8s_*) — encode the
    // discriminator as a synthetic vm criterion so it shows up in the
    // inspector.
    const type = pickString(m, 'type', 'resourceType', 'resource_type');
    if (type) {
      const value = pickString(m, 'name', 'account_name', 'accountName', 'region', 'res_id', 'fqdn');
      if (value !== undefined) {
        criteria.push({ type: 'vm', key: type, operator: 'equals', value });
      }
    }
  }

  return {
    id,
    name,
    color: colorFor(index),
    criteria,
    matchType: 'any',
  };
}

function mapWebGroup(raw: unknown, index: number): WebGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = stableId('wg', o, index);
  const name = pickString(o, 'name', 'displayName', 'display_name') ?? `WebGroup ${index + 1}`;

  const fqdns: string[] = [];
  const directFqdns = pickArray(o, 'fqdns', 'fqdn_list', 'fqdnList');
  if (directFqdns) for (const f of directFqdns) if (typeof f === 'string') fqdns.push(f);

  // selector { match_expressions { snifilter | urlfilter | fqdn } }
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

  return { id, name, fqdns };
}

function mapThreatGroup(raw: unknown, index: number): ThreatGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    id: stableId('tg', o, index),
    name: pickString(o, 'name', 'displayName', 'display_name') ?? `ThreatGroup ${index + 1}`,
    category: (pickString(o, 'category', 'kind') ?? 'custom') as ThreatGroup['category'],
    entryCount: asNumber(o['entryCount'] ?? o['entry_count'] ?? o['count']) ?? 0,
  };
}

function mapGeoGroup(raw: unknown, index: number): GeoGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const countries = pickArray(o, 'countries', 'country_codes', 'countryCodes') ?? [];
  return {
    id: stableId('gg', o, index),
    name: pickString(o, 'name', 'displayName', 'display_name') ?? `GeoGroup ${index + 1}`,
    countries: countries.filter((c): c is string => typeof c === 'string'),
  };
}

function mapPolicy(raw: unknown, index: number): DcfPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const actionRaw = (pickString(o, 'action') ?? 'DENY').toUpperCase();
  const action: DcfPolicy['action'] =
    actionRaw === 'PERMIT' || actionRaw === 'ALLOW' ? 'allow'
    : actionRaw === 'LEARNED' ? 'learned'
    : 'deny';

  const protoRaw = (pickString(o, 'protocol') ?? 'ANY').toLowerCase();
  const protocol: Protocol = (['tcp', 'udp', 'icmp', 'any'].includes(protoRaw) ? protoRaw : 'any') as Protocol;

  const ports = pickArray(o, 'portRanges', 'port_ranges')?.filter((p): p is string => typeof p === 'string').join(',');

  const src = firstString(pickArray(o, 'srcSmartGroups', 'src_smart_groups'));
  const dst = firstString(pickArray(o, 'dstSmartGroups', 'dst_smart_groups'));
  const srcExcl = (pickArray(o, 'srcExcludeSmartGroups', 'src_exclude_smart_groups') ?? []).filter((s): s is string => typeof s === 'string');
  const dstExcl = (pickArray(o, 'dstExcludeSmartGroups', 'dst_exclude_smart_groups') ?? []).filter((s): s is string => typeof s === 'string');
  const webGroups = (pickArray(o, 'webGroups', 'web_groups') ?? []).filter((s): s is string => typeof s === 'string');

  return {
    id: stableId('pol', o, index),
    name: pickString(o, 'name') ?? `Policy ${index + 1}`,
    priority: asNumber(o['priority']) ?? 100 + index,
    srcGroupId: src ?? 'sg-any',
    dstGroupId: dst ?? 'sg-any',
    srcExcludeGroupIds: srcExcl.length > 0 ? srcExcl : undefined,
    dstExcludeGroupIds: dstExcl.length > 0 ? dstExcl : undefined,
    webGroupIds: webGroups.length > 0 ? webGroups : undefined,
    threatGroup: pickString(o, 'threatGroup', 'threat_group'),
    geoGroup: pickString(o, 'geoGroup', 'geo_group'),
    action,
    protocol,
    ports: ports && ports.length > 0 ? ports : undefined,
    logging: o['logging'] === true,
    decrypt: o['decrypt'] === true || pickString(o, 'decryptPolicy', 'decrypt_policy') === 'DECRYPT_REQUIRED',
    enforcement: o['enforcement'] !== false,
  };
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

/**
 * Some controllers wrap match_expressions inside a `selector` block (or a
 * list of selector blocks). Walk a level or two deep so callers don't have
 * to mirror the exact nesting.
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

const INTERNET = { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' as const };
const ANY = { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' as const };

/**
 * Top-level mapping: takes the proxy's `raw` payload (already destructured
 * into the five entity arrays) and returns a complete DcfPolicyModel ready
 * to dispatch as `{ type: 'replace', topology: ... }`.
 *
 * Returns `{ topology, droppedCounts }` so the UI can surface "N items
 * couldn't be mapped" without obscuring partial successes.
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

  // Always ensure both pseudo-groups exist. The evaluator, simulator, and
  // graph view all reference these by id; without sg-any in particular, every
  // policy that falls back to sg-any (e.g. unresolved UUID references) renders
  // as a dangling edge in the Graph view and gets silently skipped.
  if (!smartGroups.some((g) => g.id === 'sg-any')) {
    smartGroups.unshift(ANY);
  }
  if (!smartGroups.some((g) => g.id === 'sg-internet')) {
    smartGroups.unshift(INTERNET);
  }

  return {
    topology: { smartGroups, webGroups, threatGroups, geoGroups, policies, flows: [] },
    droppedCounts,
  };
}
