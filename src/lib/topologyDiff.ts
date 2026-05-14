import type { DcfPolicyModel, SmartGroup, WebGroup, ThreatGroup, GeoGroup, DcfPolicy } from '../types/dcf';

/**
 * Structural diff between two `DcfPolicyModel`s. Used by the History modal
 * to surface "what changed between save A and save B" and (later) by
 * import/live-fetch flows to preview what an apply would do.
 *
 * Pure function. Deterministic. Independent of how the topologies were
 * loaded — same shape whether you're diffing two autosaves, a manual
 * snapshot against the live state, or an import preview against current.
 *
 * Identity model: entities are matched by `id` across the two sides. An entity
 * present in `before` but absent in `after` is "removed"; absent in `before`
 * but present in `after` is "added"; present in both but with different
 * fields is "modified" (with a per-field changes record).
 *
 * Note: the `sg-any` and `sg-internet` pseudo-groups are intentionally
 * filtered out of the diff. They're always present in every topology by
 * design (every producer seeds them) and aren't user-edited, so reporting
 * "added Internet" on a fresh import would be noise.
 */

const PSEUDO_SG_IDS = new Set(['sg-any', 'sg-internet']);

export type EntityKind = 'smartGroup' | 'webGroup' | 'threatGroup' | 'geoGroup' | 'policy';

/** A per-field change: from -> to. Values are JSON-serializable. */
export type FieldChange = { from: unknown; to: unknown };

export interface EntityDiff<T> {
  /** Reference to the entity, taken from `after` for modified/added and from `before` for removed. */
  entity: T;
  changes?: Record<string, FieldChange>;
}

export interface EntityDiffSection<T> {
  added: T[];
  removed: T[];
  modified: Array<EntityDiff<T>>;
}

export interface TopologyDiff {
  smartGroups: EntityDiffSection<SmartGroup>;
  webGroups: EntityDiffSection<WebGroup>;
  threatGroups: EntityDiffSection<ThreatGroup>;
  geoGroups: EntityDiffSection<GeoGroup>;
  policies: EntityDiffSection<DcfPolicy>;
  /** Total non-zero entries across all sections — used to render "+3 / -1 / ~5" badges quickly. */
  totals: { added: number; removed: number; modified: number };
  /** True when every section is empty (no user-visible change). */
  isEmpty: boolean;
}

/**
 * Compare two arrays of entities by id, returning the diff section. The
 * matcher `fieldsOf` returns the field bag we compare for "modified"
 * detection — typically every field except id.
 */
function diffEntityArrays<T extends { id: string }>(
  before: T[],
  after: T[],
  fieldsOf: (e: T) => Record<string, unknown>,
): EntityDiffSection<T> {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));

  const added: T[] = [];
  const removed: T[] = [];
  const modified: Array<EntityDiff<T>> = [];

  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) {
      added.push(a);
      continue;
    }
    const changes = diffFields(fieldsOf(b), fieldsOf(a));
    if (Object.keys(changes).length > 0) {
      modified.push({ entity: a, changes });
    }
  }
  for (const b of before) {
    if (!afterById.has(b.id)) removed.push(b);
  }

  return { added, removed, modified };
}

function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (!deepEqual(before[k], after[k])) {
      out[k] = { from: before[k], to: after[k] };
    }
  }
  return out;
}

/**
 * Conservative deep-equal: JSON-stringify after sorting object keys so two
 * objects that differ only in key insertion order register as equal. Fast
 * enough for the topology shapes we have (low thousands of entries).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as object).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

// Field extractors — explicitly enumerate so adding a new field to a type
// doesn't silently change the diff result. Each extractor drops `id` (used
// only for matching) and includes everything else.

function smartGroupFields(g: SmartGroup): Record<string, unknown> {
  return { name: g.name, color: g.color, criteria: g.criteria, matchType: g.matchType };
}
function webGroupFields(g: WebGroup): Record<string, unknown> {
  return { name: g.name, fqdns: g.fqdns };
}
function threatGroupFields(g: ThreatGroup): Record<string, unknown> {
  return { name: g.name, category: g.category, entryCount: g.entryCount };
}
function geoGroupFields(g: GeoGroup): Record<string, unknown> {
  return { name: g.name, countries: g.countries };
}
function policyFields(p: DcfPolicy): Record<string, unknown> {
  return {
    name: p.name,
    priority: p.priority,
    srcGroupId: p.srcGroupId,
    dstGroupId: p.dstGroupId,
    srcExcludeGroupIds: p.srcExcludeGroupIds,
    dstExcludeGroupIds: p.dstExcludeGroupIds,
    action: p.action,
    protocol: p.protocol,
    ports: p.ports,
    logging: p.logging,
    decrypt: p.decrypt,
    enforcement: p.enforcement,
    threatGroup: p.threatGroup,
    geoGroup: p.geoGroup,
    webGroupIds: p.webGroupIds,
  };
}

export function diffTopologies(before: DcfPolicyModel, after: DcfPolicyModel): TopologyDiff {
  // Filter pseudo SmartGroups out of both sides before diffing so they never appear in results.
  const beforeSG = before.smartGroups.filter((g) => !PSEUDO_SG_IDS.has(g.id));
  const afterSG = after.smartGroups.filter((g) => !PSEUDO_SG_IDS.has(g.id));

  const smartGroups = diffEntityArrays(beforeSG, afterSG, smartGroupFields);
  const webGroups = diffEntityArrays(before.webGroups, after.webGroups, webGroupFields);
  const threatGroups = diffEntityArrays(before.threatGroups, after.threatGroups, threatGroupFields);
  const geoGroups = diffEntityArrays(before.geoGroups, after.geoGroups, geoGroupFields);
  const policies = diffEntityArrays(before.policies, after.policies, policyFields);

  const sections = [smartGroups, webGroups, threatGroups, geoGroups, policies];
  const totals = sections.reduce(
    (acc, s) => ({
      added: acc.added + s.added.length,
      removed: acc.removed + s.removed.length,
      modified: acc.modified + s.modified.length,
    }),
    { added: 0, removed: 0, modified: 0 },
  );

  return {
    smartGroups,
    webGroups,
    threatGroups,
    geoGroups,
    policies,
    totals,
    isEmpty: totals.added === 0 && totals.removed === 0 && totals.modified === 0,
  };
}
