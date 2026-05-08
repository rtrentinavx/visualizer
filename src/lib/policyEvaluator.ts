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

      const sameSrc = high.srcGroupId === low.srcGroupId || high.srcGroupId === 'sg-any' || low.srcGroupId === 'sg-any';
      const sameDst = high.dstGroupId === low.dstGroupId || high.dstGroupId === 'sg-any' || low.dstGroupId === 'sg-any';
      const sameProto = high.protocol === low.protocol || high.protocol === 'any' || low.protocol === 'any';
      const portOverlap = (() => {
        if (high.ports === undefined || high.ports === 'any' || low.ports === undefined || low.ports === 'any') {
          return true;
        }
        const highPorts = high.ports.split(',').map((p) => p.trim());
        const lowPorts = low.ports.split(',').map((p) => p.trim());
        return highPorts.some((hp) => lowPorts.includes(hp));
      })();

      if (sameSrc && sameDst && sameProto && portOverlap) {
        findings.push({
          id: `shadow-${low.id}`,
          severity: 'warning',
          title: 'Shadowed Policy',
          description: `Policy "${low.name}" (priority ${low.priority}) is shadowed by "${high.name}" (priority ${high.priority}). It will never be evaluated. Aviatrix guide: rules are first-enforced-match.`,
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
      severity: 'error',
      title: 'Missing Catch-All Deny',
      description: 'No deny-all policy found. Per Aviatrix Best Practices: set the Post Rules Policy List to block all non-defined items. Unmatched traffic may be implicitly allowed.',
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
      description: `Policy "${p.name}" allows all traffic (any → any). Aviatrix Best Practice: narrow source/destination to specific SmartGroups and set a Post Rules deny-all.`,
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
      description: `Policy "${p.name}" denies traffic but has logging disabled. Aviatrix Best Practice: enable logging on deny rules for auditability. Send logs to CoPilot and SIEM.`,
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
        description: `Policy "${p.name}" allows internet traffic without threat intelligence or geo restrictions. Aviatrix Best Practice: add ExternalGroups (ThreatGroups or GeoGroups) for protection.`,
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
          description: `Multiple policies between ${group[0].srcGroupId} → ${group[0].dstGroupId} have conflicting actions. Priority order determines the winner. Aviatrix guide: rules are first-enforced-match.`,
          affectedPolicyIds: group.map((p) => p.id),
        });
      }
    }
  });

  return findings;
}

// ---- Aviatrix Best Practice: L7 Rules ----

function findWebGroupEgressViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.webGroupIds && p.webGroupIds.length > 0 && p.dstGroupId !== 'sg-internet')
    .map((p) => ({
      id: `webgroup-egress-${p.id}`,
      severity: 'error',
      title: 'WebGroup Rule Must Target Internet',
      description: `Policy "${p.name}" uses WebGroups but destination is not "Internet". Aviatrix Best Practice: WebGroup rules should target Public Internet as the destination.`,
      affectedPolicyIds: [p.id],
    }));
}

function findTlsDecryptPortViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.decrypt && (!p.ports || !p.ports.includes('443')))
    .map((p) => ({
      id: `tls-decrypt-port-${p.id}`,
      severity: 'warning',
      title: 'TLS Decryption Should Target Port 443',
      description: `Policy "${p.name}" has TLS Decryption enabled but does not target port 443. Aviatrix Best Practice: TLS decryption only applies to TCP:443 (HTTPS) traffic.`,
      affectedPolicyIds: [p.id],
    }));
}

function findTlsDecryptProtocolViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.decrypt && p.protocol !== 'tcp')
    .map((p) => ({
      id: `tls-decrypt-proto-${p.id}`,
      severity: 'error',
      title: 'TLS Decryption Requires TCP Protocol',
      description: `Policy "${p.name}" has TLS Decryption enabled with protocol "${p.protocol}". Aviatrix Best Practice: TLS decryption only applies to TCP traffic. Set protocol to TCP.`,
      affectedPolicyIds: [p.id],
    }));
}

function findBroadAllowWithoutPorts(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.action === 'allow' && p.protocol === 'any' && (!p.ports || p.ports === 'any') && !p.webGroupIds)
    .map((p) => ({
      id: `broad-allow-${p.id}`,
      severity: 'warning',
      title: 'Overly Broad Allow Rule',
      description: `Policy "${p.name}" allows any protocol on any port. Aviatrix Best Practice: separate Layer 4 rules by protocol and explicitly set ports when possible.`,
      affectedPolicyIds: [p.id],
    }));
}

function findDuplicateNames(policies: DcfPolicy[]): Finding[] {
  const nameMap = new Map<string, string[]>();
  policies.forEach((p) => {
    if (!nameMap.has(p.name)) nameMap.set(p.name, []);
    nameMap.get(p.name)!.push(p.id);
  });

  const findings: Finding[] = [];
  nameMap.forEach((ids, name) => {
    if (ids.length > 1) {
      findings.push({
        id: `duplicate-name-${name}`,
        severity: 'warning',
        title: 'Duplicate Policy Name',
        description: `Multiple policies share the name "${name}". Aviatrix Best Practice: unique names prevent upgrade failures and make auditing easier.`,
        affectedPolicyIds: ids,
      });
    }
  });
  return findings;
}

function findSelfToSelfPolicies(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.srcGroupId === p.dstGroupId && p.srcGroupId !== 'sg-any')
    .map((p) => ({
      id: `self-to-self-${p.id}`,
      severity: 'info',
      title: 'Self-to-Self Policy',
      description: `Policy "${p.name}" has the same source and destination group. Traffic within the same SmartGroup is typically handled at the workload level, not by DCF inter-group policies.`,
      affectedPolicyIds: [p.id],
    }));
}

function findDuplicatePriorities(policies: DcfPolicy[]): Finding[] {
  const priorityMap = new Map<number, string[]>();
  policies.forEach((p) => {
    if (!priorityMap.has(p.priority)) priorityMap.set(p.priority, []);
    priorityMap.get(p.priority)!.push(p.id);
  });

  const findings: Finding[] = [];
  priorityMap.forEach((ids, priority) => {
    if (ids.length > 1) {
      findings.push({
        id: `duplicate-priority-${priority}`,
        severity: 'warning',
        title: 'Duplicate Priority',
        description: `${ids.length} policies share priority ${priority}. Aviatrix evaluates rules in priority order; duplicates can cause non-deterministic enforcement. Use unique priority values.`,
        affectedPolicyIds: ids,
      });
    }
  });
  return findings;
}

function findMissingLoggingOnAllow(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.action === 'allow' && !p.logging)
    .map((p) => ({
      id: `missing-log-allow-${p.id}`,
      severity: 'info',
      title: 'Allow Policy Without Logging',
      description: `Policy "${p.name}" allows traffic but has logging disabled. Best Practice: enable logging on allow rules for auditability and traffic analysis in CoPilot/SIEM.`,
      affectedPolicyIds: [p.id],
    }));
}

function findLearnedWithoutDenyAll(policies: DcfPolicy[]): Finding[] {
  const hasDenyAll = policies.some((p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any');
  const hasLearned = policies.some((p) => p.action === 'learned');

  if (hasLearned && !hasDenyAll) {
    return [{
      id: 'learned-without-deny-all',
      severity: 'warning',
      title: 'Learned Rules Without Deny-All',
      description: 'You have learned-mode policies but no catch-all deny. Aviatrix Best Practice: learned policies discover traffic patterns; pair them with a Post Rules deny-all to block undefined traffic.',
    }];
  }
  return [];
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

  // Aviatrix Best Practice checks from Configuration Guide
  findings.push(...findWebGroupEgressViolation(topology.policies));
  findings.push(...findTlsDecryptPortViolation(topology.policies));
  findings.push(...findTlsDecryptProtocolViolation(topology.policies));
  findings.push(...findBroadAllowWithoutPorts(topology.policies));
  findings.push(...findLearnedWithoutDenyAll(topology.policies));

  // Industry best-practice checks
  findings.push(...findDuplicateNames(topology.policies));
  findings.push(...findSelfToSelfPolicies(topology.policies));
  findings.push(...findDuplicatePriorities(topology.policies));
  findings.push(...findMissingLoggingOnAllow(topology.policies));

  // Sort by severity
  const severityOrder = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}
