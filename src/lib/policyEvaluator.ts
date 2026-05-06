import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  affectedPolicyIds?: string[];
  affectedGroupIds?: string[];
}

function findShadowedPolicies(policies: DcfPolicy[]): Finding[] {
  const findings: Finding[] = [];
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const high = sorted[i];
      const low = sorted[j];

      // Check if high priority policy shadows low priority one
      const sameSrc = high.srcGroupId === low.srcGroupId || high.srcGroupId === 'sg-any' || low.srcGroupId === 'sg-any';
      const sameDst = high.dstGroupId === low.dstGroupId || high.dstGroupId === 'sg-any' || low.dstGroupId === 'sg-any';
      const sameProto = high.protocol === low.protocol || high.protocol === 'any' || low.protocol === 'any';
      const sameDir = high.direction === low.direction || high.direction === 'any' || low.direction === 'any';

      // Port overlap check
      const portOverlap = (() => {
        if (high.ports === undefined || high.ports === 'any' || low.ports === undefined || low.ports === 'any') {
          return true;
        }
        const highPorts = high.ports.split(',').map((p) => p.trim());
        const lowPorts = low.ports.split(',').map((p) => p.trim());
        return highPorts.some((hp) => lowPorts.includes(hp));
      })();

      if (sameSrc && sameDst && sameProto && sameDir && portOverlap) {
        findings.push({
          id: `shadow-${low.id}`,
          severity: 'warning',
          title: 'Shadowed Policy',
          description: `Policy "${low.name}" (priority ${low.priority}) is shadowed by "${high.name}" (priority ${high.priority}). It will never be evaluated.`,
          affectedPolicyIds: [low.id, high.id],
        });
      }
    }
  }

  return findings;
}

function findMissingDenyAll(policies: DcfPolicy[]): Finding[] {
  const hasDenyAll = policies.some(
    (p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any'
  );

  if (!hasDenyAll && policies.length > 0) {
    return [{
      id: 'missing-deny-all',
      severity: 'warning',
      title: 'Missing Catch-All Deny',
      description: 'No deny-all policy found. Without a catch-all deny at the lowest priority, unmatched traffic may be implicitly allowed.',
    }];
  }

  return [];
}

function findOverlyPermissive(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.action === 'allow' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any')
    .map((p) => ({
      id: `overly-permissive-${p.id}`,
      severity: 'error',
      title: 'Overly Permissive Policy',
      description: `Policy "${p.name}" allows all traffic (any → any). Consider narrowing source/destination groups.`,
      affectedPolicyIds: [p.id],
    }));
}

function findUnusedGroups(topology: DcfPolicyModel): Finding[] {
  const usedGroupIds = new Set<string>();
  topology.policies.forEach((p) => {
    usedGroupIds.add(p.srcGroupId);
    usedGroupIds.add(p.dstGroupId);
    p.srcExcludeGroupIds?.forEach((id) => usedGroupIds.add(id));
    p.dstExcludeGroupIds?.forEach((id) => usedGroupIds.add(id));
  });

  return topology.smartGroups
    .filter((g) => g.id !== 'sg-any' && g.id !== 'sg-internet' && !usedGroupIds.has(g.id))
    .map((g) => ({
      id: `unused-group-${g.id}`,
      severity: 'info',
      title: 'Unused SmartGroup',
      description: `Group "${g.name}" is not referenced by any policy. Consider removing it or creating policies for it.`,
      affectedGroupIds: [g.id],
    }));
}

function findMissingLogging(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => !p.logging && p.action === 'deny')
    .map((p) => ({
      id: `missing-log-${p.id}`,
      severity: 'warning',
      title: 'Deny Policy Without Logging',
      description: `Policy "${p.name}" denies traffic but has logging disabled. You won't see hits in your traffic logs.`,
      affectedPolicyIds: [p.id],
    }));
}

function findMissingThreatProtection(topology: DcfPolicyModel): Finding[] {
  const internetPolicies = topology.policies.filter(
    (p) =>
      p.srcGroupId === 'sg-internet' ||
      p.dstGroupId === 'sg-internet' ||
      p.srcGroupId === 'sg-any' ||
      p.dstGroupId === 'sg-any'
  );

  const findings: Finding[] = [];

  internetPolicies.forEach((p) => {
    if (p.action === 'allow' && !p.threatGroup && !p.geoGroup) {
      findings.push({
        id: `missing-threat-${p.id}`,
        severity: 'info',
        title: 'Internet Policy Lacks Threat/Geo Filtering',
        description: `Policy "${p.name}" allows internet traffic without threat intelligence or geo restrictions. Consider adding a ThreatGroup or GeoGroup.`,
        affectedPolicyIds: [p.id],
      });
    }
  });

  return findings;
}

function findConflictingActions(policies: DcfPolicy[]): Finding[] {
  const findings: Finding[] = [];
  const byPair = new Map<string, DcfPolicy[]>();

  policies.forEach((p) => {
    const key = `${p.srcGroupId}|${p.dstGroupId}|${p.protocol}|${p.ports || 'any'}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(p);
  });

  byPair.forEach((group) => {
    if (group.length < 2) return;
    const actions = new Set(group.map((p) => p.action));
    if (actions.size > 1) {
      const allowDeny = group.filter((p) => p.action === 'allow' || p.action === 'deny');
      if (allowDeny.length >= 2) {
        findings.push({
          id: `conflict-${group[0].id}`,
          severity: 'warning',
          title: 'Conflicting Actions',
          description: `Multiple policies between ${group[0].srcGroupId} → ${group[0].dstGroupId} have conflicting actions. Priority order determines the winner.`,
          affectedPolicyIds: group.map((p) => p.id),
        });
      }
    }
  });

  return findings;
}

export function evaluateTopology(topology: DcfPolicyModel): Finding[] {
  const findings: Finding[] = [];

  findings.push(...findShadowedPolicies(topology.policies));
  findings.push(...findMissingDenyAll(topology.policies));
  findings.push(...findOverlyPermissive(topology.policies));
  findings.push(...findUnusedGroups(topology));
  findings.push(...findMissingLogging(topology.policies));
  findings.push(...findMissingThreatProtection(topology));
  findings.push(...findConflictingActions(topology.policies));

  // Sort by severity
  const severityOrder = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}
