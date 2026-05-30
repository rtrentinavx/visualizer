import type { DcfPolicy, PolicyAction } from '../../types/dcf';

export interface GroupedEdge {
  id: string;
  source: string;
  target: string;
  policies: DcfPolicy[];
  effectiveAction: PolicyAction | 'mixed';
  isBidirectional: boolean;
  hasL7Inspection: boolean;
  hasUnenforced: boolean;
  hasNoLogging: boolean;
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
}

const ACTION_COLORS: Record<PolicyAction, string> = {
  allow: '#22c55e',
  deny: '#ef4444',
  learned: '#f59e0b',
};

function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function deriveEffectiveAction(sorted: DcfPolicy[]): PolicyAction | 'mixed' {
  if (sorted.length === 0) return 'deny';
  const first = sorted[0]!.action;
  return sorted.every((p) => p.action === first) ? first : 'mixed';
}

export function groupPoliciesIntoEdges(policies: DcfPolicy[]): GroupedEdge[] {
  // Pass 1: bucket into directed (src, dst) map
  const edgeMap = new Map<string, DcfPolicy[]>();
  for (const policy of policies) {
    const key = `edge::${policy.srcGroupId}::${policy.dstGroupId}`;
    let bucket = edgeMap.get(key);
    if (!bucket) {
      bucket = [];
      edgeMap.set(key, bucket);
    }
    bucket.push(policy);
  }

  for (const bucket of edgeMap.values()) {
    bucket.sort((a, b) => a.priority - b.priority);
  }

  // Pass 2: bidir scan using lexicographically stable canonical key
  const bidirSet = new Set<string>();
  for (const key of edgeMap.keys()) {
    const parts = key.split('::');
    const src = parts[1] ?? '';
    const tgt = parts[2] ?? '';
    if (edgeMap.has(`edge::${tgt}::${src}`)) {
      bidirSet.add(canonicalPairKey(src, tgt));
    }
  }

  // Pass 3: assemble
  const result: GroupedEdge[] = [];
  for (const [key, sorted] of edgeMap) {
    const parts = key.split('::');
    const source = parts[1] ?? '';
    const target = parts[2] ?? '';

    const hasL7Inspection = sorted.some(
      (p) =>
        p.decrypt === true ||
        (Array.isArray(p.webGroupIds) && p.webGroupIds.length > 0),
    );
    const hasUnenforced = sorted.some((p) => p.enforcement === false);
    const hasNoLogging = sorted.some((p) => p.logging === false);

    result.push({
      id: key,
      source,
      target,
      policies: sorted,
      effectiveAction: deriveEffectiveAction(sorted),
      isBidirectional: bidirSet.has(canonicalPairKey(source, target)),
      hasL7Inspection,
      hasUnenforced,
      hasNoLogging,
    });
  }

  return result;
}

export function getPriorityStripColors(policies: DcfPolicy[]): string[] {
  return policies.map((p) => ACTION_COLORS[p.action] ?? '#6b7280');
}

export function getEdgeStyle(edge: GroupedEdge): EdgeStyle {
  const STROKE: Record<GroupedEdge['effectiveAction'], string> = {
    allow: '#22c55e',
    deny: '#ef4444',
    learned: '#f59e0b',
    mixed: '#a855f7',
  };

  const stroke = STROKE[edge.effectiveAction];

  let strokeWidth = 1.5;
  if (edge.isBidirectional) strokeWidth += 0.75;
  if (edge.hasL7Inspection) strokeWidth += 0.5;

  let strokeDasharray: string | undefined;
  if (edge.hasUnenforced) {
    strokeDasharray = '8 4';
  } else if (edge.hasNoLogging) {
    strokeDasharray = '2 3';
  }

  const style: EdgeStyle = { stroke, strokeWidth };
  if (strokeDasharray !== undefined) {
    style.strokeDasharray = strokeDasharray;
  }
  return style;
}
