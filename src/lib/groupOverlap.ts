import type { SmartGroup } from '../types/dcf';
import { cidrsOverlap } from './ipUtils';

export type OverlapKind = 'none' | 'partial' | 'contains' | 'contained-by';

export interface OverlapRelation {
  otherId: string;
  otherName: string;
  kind: OverlapKind;
}

function getCidrs(g: SmartGroup): string[] {
  return g.criteria.filter((c) => c.type === 'subnet' && c.cidr).map((c) => c.cidr!);
}

function cidrBits(cidr: string): number {
  const slash = cidr.indexOf('/');
  if (slash < 0) return 32;
  const mask = cidr.slice(slash + 1);
  if (mask.includes('.')) {
    // dotted decimal — count set bits
    const parts = mask.split('.');
    return parts.reduce((acc, p) => {
      let n = parseInt(p, 10);
      let bits = 0;
      while (n) { bits += n & 1; n >>>= 1; }
      return acc + bits;
    }, 0);
  }
  return parseInt(mask, 10) || 0;
}

function cidrContains(outer: string, inner: string): boolean {
  if (!cidrsOverlap(outer, inner)) return false;
  return cidrBits(outer) <= cidrBits(inner);
}

export function computeOverlap(a: SmartGroup, b: SmartGroup): OverlapKind {
  if (a.id === b.id) return 'none';
  const aCidrs = getCidrs(a);
  const bCidrs = getCidrs(b);
  if (aCidrs.length === 0 || bCidrs.length === 0) return 'none';

  let anyOverlap = false;
  let allAContainedByB = true;
  let allBContainedByA = true;

  for (const ac of aCidrs) {
    const containedInB = bCidrs.some((bc) => cidrContains(bc, ac));
    if (!containedInB) allAContainedByB = false;
    const overlapsAny = bCidrs.some((bc) => cidrsOverlap(ac, bc));
    if (overlapsAny) anyOverlap = true;
  }
  for (const bc of bCidrs) {
    const containedInA = aCidrs.some((ac) => cidrContains(ac, bc));
    if (!containedInA) allBContainedByA = false;
  }

  if (!anyOverlap) return 'none';
  if (allAContainedByB) return 'contained-by'; // a is inside b
  if (allBContainedByA) return 'contains';     // a contains b
  return 'partial';
}

export interface OverlapMap {
  // groupId → list of relations with other groups
  relations: Map<string, OverlapRelation[]>;
  // ordered group list with depth for indentation (parent first, then children)
  orderedWithDepth: Array<{ group: SmartGroup; depth: number }>;
}

export function buildOverlapMap(groups: SmartGroup[]): OverlapMap {
  const relations = new Map<string, OverlapRelation[]>();
  for (const g of groups) relations.set(g.id, []);

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!;
      const b = groups[j]!;
      const kind = computeOverlap(a, b);
      if (kind === 'none') continue;
      const reverseKind: OverlapKind =
        kind === 'contains' ? 'contained-by' :
        kind === 'contained-by' ? 'contains' : 'partial';
      relations.get(a.id)!.push({ otherId: b.id, otherName: b.name, kind });
      relations.get(b.id)!.push({ otherId: a.id, otherName: a.name, kind: reverseKind });
    }
  }

  // Build parent→children tree for indentation.
  // A group is a "parent" of another if kind=contains (it contains the other).
  const childOf = new Map<string, string>(); // childId → parentId
  for (const [id, rels] of relations) {
    for (const rel of rels) {
      if (rel.kind === 'contained-by') {
        // id is contained-by rel.otherId → rel.otherId is parent of id
        // only set if not already claimed (first parent wins)
        if (!childOf.has(id)) childOf.set(id, rel.otherId);
      }
    }
  }

  // Topological sort: roots first, then children
  const visited = new Set<string>();
  const orderedWithDepth: Array<{ group: SmartGroup; depth: number }> = [];

  function visit(g: SmartGroup, depth: number) {
    if (visited.has(g.id)) return;
    visited.add(g.id);
    orderedWithDepth.push({ group: g, depth });
    // visit children
    for (const child of groups) {
      if (childOf.get(child.id) === g.id) visit(child, depth + 1);
    }
  }

  // Roots = groups with no parent
  for (const g of groups) {
    if (!childOf.has(g.id)) visit(g, 0);
  }
  // Catch any stragglers (circular or multi-parent edge cases)
  for (const g of groups) visit(g, 0);

  return { relations, orderedWithDepth };
}

export function overlapPercent(a: SmartGroup, b: SmartGroup): number {
  const kind = computeOverlap(a, b);
  if (kind === 'none') return 0;
  if (kind === 'contains' || kind === 'contained-by') return 100;
  return 50; // partial — no exact % without full IP enumeration
}
