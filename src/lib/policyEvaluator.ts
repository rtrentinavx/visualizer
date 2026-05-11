import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';

export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingCategory = 'security' | 'naming' | 'performance' | 'compliance' | 'hygiene';
export type Framework = 'Aviatrix BP' | 'CIS' | 'NIST ZT' | 'Best Practice';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  frameworks: Framework[];
  title: string;
  description: string;
  affectedPolicyIds?: string[];
  affectedGroupIds?: string[];
  fixable?: boolean;
  fixDescription?: string;
}

export interface EvaluationReport {
  findings: Finding[];
  score: number; // 0-100
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    total: number;
    fixable: number;
  };
  categories: Record<FindingCategory, number>;
}

// ---------- Individual Check Functions ----------

function findShadowedPolicies(policies: DcfPolicy[]): Finding[] {
  const findings: Finding[] = [];
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const high = sorted[i]!;
      const low = sorted[j]!;

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
          category: 'performance',
          frameworks: ['Aviatrix BP', 'Best Practice'],
          title: 'Shadowed Policy',
          description: `Policy "${low.name}" (priority ${low.priority}) is shadowed by "${high.name}" (priority ${high.priority}). It will never be evaluated. Aviatrix guide: rules are first-enforced-match.`,
          affectedPolicyIds: [low.id, high.id],
          fixable: true,
          fixDescription: `Disable "${low.name}" (set enforcement off)`,
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
      category: 'security',
      frameworks: ['Aviatrix BP', 'NIST ZT', 'CIS'],
      title: 'Missing Catch-All Deny',
      description: 'No deny-all policy found. Per Aviatrix Best Practices: set the Post Rules Policy List to block all non-defined items. Unmatched traffic may be implicitly allowed.',
      fixable: true,
      fixDescription: 'Create a catch-all deny policy at priority 9999',
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
      category: 'security',
      frameworks: ['NIST ZT', 'CIS', 'Aviatrix BP'],
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
      category: 'hygiene',
      frameworks: ['Best Practice'],
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
      category: 'compliance',
      frameworks: ['Aviatrix BP', 'CIS', 'NIST ZT'],
      title: 'Deny Policy Without Logging',
      description: `Policy "${p.name}" denies traffic but has logging disabled. Aviatrix Best Practice: enable logging on deny rules for auditability. Send logs to CoPilot and SIEM.`,
      affectedPolicyIds: [p.id],
      fixable: true,
      fixDescription: `Enable logging on "${p.name}"`,
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
        category: 'security',
        frameworks: ['Aviatrix BP', 'NIST ZT'],
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
    const first = group[0];
    if (!first) return;
    const actions = new Set(group.map((p) => p.action));
    if (actions.size > 1) {
      const allowDeny = group.filter((p) => p.action === 'allow' || p.action === 'deny');
      if (allowDeny.length >= 2) {
        findings.push({
          id: `conflict-${first.id}`,
          severity: 'warning',
          category: 'security',
          frameworks: ['Aviatrix BP', 'Best Practice'],
          title: 'Conflicting Actions',
          description: `Multiple policies between ${first.srcGroupId} → ${first.dstGroupId} have conflicting actions. Priority order determines the winner. Aviatrix guide: rules are first-enforced-match.`,
          affectedPolicyIds: group.map((p) => p.id),
        });
      }
    }
  });

  return findings;
}

function findWebGroupEgressViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.webGroupIds && p.webGroupIds.length > 0 && p.dstGroupId !== 'sg-internet')
    .map((p) => ({
      id: `webgroup-egress-${p.id}`,
      severity: 'error',
      category: 'compliance',
      frameworks: ['Aviatrix BP'],
      title: 'WebGroup Rule Must Target Internet',
      description: `Policy "${p.name}" uses WebGroups but destination is not "Internet". Aviatrix Best Practice: WebGroup rules should target Public Internet as the destination.`,
      affectedPolicyIds: [p.id],
      fixable: true,
      fixDescription: `Change destination of "${p.name}" to Internet`,
    }));
}

function findTlsDecryptPortViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => {
      if (!p.decrypt) return false;
      if (!p.ports) return true;
      const ports = p.ports.split(',').map((s) => s.trim());
      return !ports.includes('443');
    })
    .map((p) => ({
      id: `tls-decrypt-port-${p.id}`,
      severity: 'warning',
      category: 'compliance',
      frameworks: ['Aviatrix BP', 'Best Practice'],
      title: 'TLS Decryption Should Target Port 443',
      description: `Policy "${p.name}" has TLS Decryption enabled but does not target port 443. Aviatrix Best Practice: TLS decryption only applies to TCP:443 (HTTPS) traffic.`,
      affectedPolicyIds: [p.id],
      fixable: true,
      fixDescription: `Set ports of "${p.name}" to 443`,
    }));
}

function findTlsDecryptProtocolViolation(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.decrypt && p.protocol !== 'tcp')
    .map((p) => ({
      id: `tls-decrypt-proto-${p.id}`,
      severity: 'error',
      category: 'compliance',
      frameworks: ['Aviatrix BP'],
      title: 'TLS Decryption Requires TCP Protocol',
      description: `Policy "${p.name}" has TLS Decryption enabled with protocol "${p.protocol}". Aviatrix Best Practice: TLS decryption only applies to TCP traffic. Set protocol to TCP.`,
      affectedPolicyIds: [p.id],
      fixable: true,
      fixDescription: `Change protocol of "${p.name}" to TCP`,
    }));
}

function findBroadAllowWithoutPorts(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.action === 'allow' && p.protocol === 'any' && (!p.ports || p.ports === 'any') && !p.webGroupIds)
    .map((p) => ({
      id: `broad-allow-${p.id}`,
      severity: 'warning',
      category: 'security',
      frameworks: ['CIS', 'NIST ZT', 'Best Practice'],
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
        category: 'naming',
        frameworks: ['Best Practice', 'Aviatrix BP'],
        title: 'Duplicate Policy Name',
        description: `Multiple policies share the name "${name}". Aviatrix Best Practice: unique names prevent upgrade failures and make auditing easier.`,
        affectedPolicyIds: ids,
        fixable: true,
        fixDescription: `Make names unique by appending numbers`,
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
      category: 'hygiene',
      frameworks: ['Best Practice'],
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
        category: 'naming',
        frameworks: ['Aviatrix BP', 'Best Practice'],
        title: 'Duplicate Priority',
        description: `${ids.length} policies share priority ${priority}. Aviatrix evaluates rules in priority order; duplicates can cause non-deterministic enforcement. Use unique priority values.`,
        affectedPolicyIds: ids,
        fixable: true,
        fixDescription: `Renumber priorities to be unique`,
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
      category: 'compliance',
      frameworks: ['CIS', 'NIST ZT', 'Best Practice'],
      title: 'Allow Policy Without Logging',
      description: `Policy "${p.name}" allows traffic but has logging disabled. Best Practice: enable logging on allow rules for auditability and traffic analysis in CoPilot/SIEM.`,
      affectedPolicyIds: [p.id],
      fixable: true,
      fixDescription: `Enable logging on "${p.name}"`,
    }));
}

function findLearnedWithoutDenyAll(policies: DcfPolicy[]): Finding[] {
  const hasDenyAll = policies.some((p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any');
  const hasLearned = policies.some((p) => p.action === 'learned');

  if (hasLearned && !hasDenyAll) {
    return [{
      id: 'learned-without-deny-all',
      severity: 'warning',
      category: 'security',
      frameworks: ['Aviatrix BP', 'NIST ZT'],
      title: 'Learned Rules Without Deny-All',
      description: 'You have learned-mode policies but no catch-all deny. Aviatrix Best Practice: learned policies discover traffic patterns; pair them with a Post Rules deny-all to block undefined traffic.',
      fixable: true,
      fixDescription: 'Create a catch-all deny policy at priority 9999',
    }];
  }
  return [];
}

// ---- NEW: Additional NIST/CIS checks ----

function findPoliciesWithoutEnforcement(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.enforcement === false)
    .map((p) => ({
      id: `no-enforcement-${p.id}`,
      severity: 'info',
      category: 'hygiene',
      frameworks: ['Best Practice', 'Aviatrix BP'],
      title: 'Policy Enforcement Disabled',
      description: `Policy "${p.name}" has enforcement disabled. It exists in the configuration but will not actively block or allow traffic. Useful for monitor mode, but verify this is intentional.`,
      affectedPolicyIds: [p.id],
    }));
}

function findHighPriorityBroadRules(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) => p.priority <= 50 && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any')
    .map((p) => ({
      id: `high-priority-broad-${p.id}`,
      severity: 'warning',
      category: 'security',
      frameworks: ['NIST ZT', 'Best Practice'],
      title: 'High-Priority Catch-All Rule',
      description: `Policy "${p.name}" is a broad any→any rule with very high priority (${p.priority}). High-priority rules are evaluated first; a catch-all at this level can shadow many specific rules below it.`,
      affectedPolicyIds: [p.id],
    }));
}

function findUnusedWebGroups(topology: DcfPolicyModel): Finding[] {
  const used = new Set<string>();
  topology.policies.forEach((p) => p.webGroupIds?.forEach((id) => used.add(id)));
  return topology.webGroups
    .filter((g) => !used.has(g.id))
    .map((g) => ({
      id: `unused-webgroup-${g.id}`,
      severity: 'info',
      category: 'hygiene',
      frameworks: ['Best Practice'],
      title: 'Unused WebGroup',
      description: `WebGroup "${g.name}" is defined but not used by any policy. Consider removing it or attaching it to an egress rule.`,
      affectedGroupIds: [g.id],
    }));
}

function findUnusedThreatGroups(topology: DcfPolicyModel): Finding[] {
  const used = new Set<string>();
  topology.policies.forEach((p) => { if (p.threatGroup) used.add(p.threatGroup); });
  return topology.threatGroups
    .filter((g) => !used.has(g.id))
    .map((g) => ({
      id: `unused-threatgroup-${g.id}`,
      severity: 'info',
      category: 'hygiene',
      frameworks: ['Best Practice'],
      title: 'Unused ThreatGroup',
      description: `ThreatGroup "${g.name}" is defined but not referenced by any policy. Attach it to internet-facing allow rules for threat protection.`,
      affectedGroupIds: [g.id],
    }));
}

function findUnusedGeoGroups(topology: DcfPolicyModel): Finding[] {
  const used = new Set<string>();
  topology.policies.forEach((p) => { if (p.geoGroup) used.add(p.geoGroup); });
  return topology.geoGroups
    .filter((g) => !used.has(g.id))
    .map((g) => ({
      id: `unused-geogroup-${g.id}`,
      severity: 'info',
      category: 'hygiene',
      frameworks: ['Best Practice'],
      title: 'Unused GeoGroup',
      description: `GeoGroup "${g.name}" is defined but not referenced by any policy. Attach it to internet-facing rules for geo-based filtering.`,
      affectedGroupIds: [g.id],
    }));
}

function findAllowInternetWithoutInspection(policies: DcfPolicy[]): Finding[] {
  return policies
    .filter((p) =>
      p.action === 'allow' &&
      (p.dstGroupId === 'sg-internet' || p.dstGroupId === 'sg-any') &&
      !p.decrypt &&
      p.protocol === 'tcp' &&
      (p.ports?.includes('443') || p.ports === 'any')
    )
    .map((p) => ({
      id: `no-inspection-${p.id}`,
      severity: 'info',
      category: 'security',
      frameworks: ['NIST ZT', 'CIS', 'Aviatrix BP'],
      title: 'HTTPS Egress Without TLS Inspection',
      description: `Policy "${p.name}" allows HTTPS (TCP/443) outbound to the internet without TLS decryption. NIST Zero Trust & CIS recommend inspecting encrypted traffic to prevent data exfiltration and malware C2.`,
      affectedPolicyIds: [p.id],
    }));
}

// ---------- Scoring ----------

function calculateScore(findings: Finding[]): number {
  if (findings.length === 0) return 100;
  const errorWeight = 15;
  const warningWeight = 5;
  const infoWeight = 1;

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;

  const deduction = errors * errorWeight + warnings * warningWeight + infos * infoWeight;
  return Math.max(0, 100 - deduction);
}

// ---------- Optimization-suggestion checks ----------

function portsCanonical(ports: string | undefined): string[] | 'any' {
  if (ports === undefined || ports === 'any' || ports === '') return 'any';
  return ports.split(',').map((p) => p.trim()).filter(Boolean);
}

function portsCoverAll(broader: string | undefined, narrower: string | undefined): boolean {
  const b = portsCanonical(broader);
  const n = portsCanonical(narrower);
  if (b === 'any') return true;
  if (n === 'any') return false;
  return n.every((p) => b.includes(p));
}

/** Two policies have identical match conditions except ports (mergeable iff they do). */
function mergeKey(p: DcfPolicy): string {
  return [
    p.srcGroupId,
    p.dstGroupId,
    p.action,
    p.protocol,
    p.threatGroup ?? '',
    p.geoGroup ?? '',
    p.decrypt ? '1' : '0',
    p.logging ? '1' : '0',
    p.enforcement === false ? '0' : '1',
    JSON.stringify((p.srcExcludeGroupIds ?? []).slice().sort()),
    JSON.stringify((p.dstExcludeGroupIds ?? []).slice().sort()),
    JSON.stringify((p.webGroupIds ?? []).slice().sort()),
  ].join('|');
}

/**
 * A policy is redundant when a SAME-ACTION later-evaluated policy (higher priority
 * number = later in first-match order) would catch all of its traffic anyway.
 * Reported as info-only; not auto-fixed because logging/decrypt deltas between the
 * two policies can mean "remove A" isn't a no-op even when actions match.
 */
function findRedundantPolicies(policies: DcfPolicy[]): Finding[] {
  const findings: Finding[] = [];
  for (const a of policies) {
    if (a.enforcement === false) continue;
    for (const b of policies) {
      if (a === b || b.enforcement === false) continue;
      if (b.priority <= a.priority) continue; // b must be later in match order
      if (a.action !== b.action) continue;

      const srcCovers = b.srcGroupId === a.srcGroupId || b.srcGroupId === 'sg-any';
      const dstCovers = b.dstGroupId === a.dstGroupId || b.dstGroupId === 'sg-any';
      const protoCovers = b.protocol === a.protocol || b.protocol === 'any';
      const portCovers = portsCoverAll(b.ports, a.ports);
      if (!srcCovers || !dstCovers || !protoCovers || !portCovers) continue;

      // Excludes: if b has an exclude that a doesn't, b doesn't actually cover a.
      const bSrcExcl = b.srcExcludeGroupIds ?? [];
      const bDstExcl = b.dstExcludeGroupIds ?? [];
      if (bSrcExcl.length > 0 || bDstExcl.length > 0) continue;

      findings.push({
        id: `redundant-${a.id}`,
        severity: 'info',
        category: 'performance',
        frameworks: ['Aviatrix BP', 'Best Practice'],
        title: 'Redundant Policy',
        description: `Policy "${a.name}" (priority ${a.priority}) is fully covered by "${b.name}" (priority ${b.priority}), which has the same action and broader match. Removing "${a.name}" would not change traffic outcomes — but verify logging/decrypt deltas before deleting.`,
        affectedPolicyIds: [a.id, b.id],
      });
      break; // one cover-finding per redundant policy
    }
  }
  return findings;
}

/**
 * Groups of 2+ policies with identical match conditions except ports can be merged
 * into one policy with comma-joined ports. Reduces policy count and rule-engine cost.
 */
function findMergeablePolicies(policies: DcfPolicy[]): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map<string, DcfPolicy[]>();
  for (const p of policies) {
    // Don't suggest merging port-any policies — there's nothing to combine.
    if (portsCanonical(p.ports) === 'any') continue;
    const key = mergeKey(p);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(p); else byKey.set(key, [p]);
  }
  byKey.forEach((bucket) => {
    if (bucket.length < 2) return;
    const sorted = [...bucket].sort((a, b) => a.priority - b.priority);
    const keeper = sorted[0]!;
    findings.push({
      id: `mergeable-${keeper.id}`,
      severity: 'info',
      category: 'performance',
      frameworks: ['Aviatrix BP', 'Best Practice'],
      title: 'Mergeable Policies',
      description: `${bucket.length} policies share src/dst/action/protocol and differ only in ports: ${bucket.map((p) => `"${p.name}"`).join(', ')}. They can be merged into one policy with comma-joined ports.`,
      affectedPolicyIds: bucket.map((p) => p.id),
      fixable: true,
      fixDescription: `Merge into "${keeper.name}" with combined ports`,
    });
  });
  return findings;
}

// ---------- Main Export ----------

export function evaluateTopology(topology: DcfPolicyModel): EvaluationReport {
  const findings: Finding[] = [];

  findings.push(...findShadowedPolicies(topology.policies));
  findings.push(...findMissingDenyAll(topology.policies));
  findings.push(...findOverlyPermissive(topology.policies));
  findings.push(...findUnusedGroups(topology));
  findings.push(...findMissingLogging(topology.policies));
  findings.push(...findMissingThreatProtection(topology));
  findings.push(...findConflictingActions(topology.policies));

  // Aviatrix Best Practice checks
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

  // Additional hygiene & security checks
  findings.push(...findPoliciesWithoutEnforcement(topology.policies));
  findings.push(...findHighPriorityBroadRules(topology.policies));
  findings.push(...findUnusedWebGroups(topology));
  findings.push(...findUnusedThreatGroups(topology));
  findings.push(...findUnusedGeoGroups(topology));
  findings.push(...findAllowInternetWithoutInspection(topology.policies));

  // Optimization suggestions
  findings.push(...findRedundantPolicies(topology.policies));
  findings.push(...findMergeablePolicies(topology.policies));

  // Sort by severity
  const severityOrder = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const fixable = findings.filter((f) => f.fixable).length;

  const categories: Record<FindingCategory, number> = {
    security: findings.filter((f) => f.category === 'security').length,
    naming: findings.filter((f) => f.category === 'naming').length,
    performance: findings.filter((f) => f.category === 'performance').length,
    compliance: findings.filter((f) => f.category === 'compliance').length,
    hygiene: findings.filter((f) => f.category === 'hygiene').length,
  };

  return {
    findings,
    score: calculateScore(findings),
    summary: { errors, warnings, infos, total: findings.length, fixable },
    categories,
  };
}

/**
 * Apply an automatic fix for a given finding.
 * Returns a new topology with the fix applied, or null if the finding is not auto-fixable.
 */
export function applyAutoFix(topology: DcfPolicyModel, finding: Finding): DcfPolicyModel | null {
  if (!finding.fixable) return null;

  const next = { ...topology, policies: [...topology.policies] };

  switch (finding.id) {
    case 'missing-deny-all':
    case 'learned-without-deny-all': {
      const maxPriority = next.policies.length > 0
        ? Math.max(...next.policies.map((p) => p.priority))
        : 0;
      const newPolicy: DcfPolicy = {
        id: `pol-deny-all-${Date.now()}`,
        name: 'Default Deny All',
        priority: Math.max(maxPriority + 10, 9999),
        srcGroupId: 'sg-any',
        dstGroupId: 'sg-any',
        action: 'deny',
        protocol: 'any',
        logging: true,
        enforcement: true,
      };
      next.policies = [...next.policies, newPolicy];
      return next;
    }
  }

  // Policy-specific fixes
  if (finding.affectedPolicyIds && finding.affectedPolicyIds.length > 0) {
    const policyId = finding.affectedPolicyIds[0];
    const policyIndex = next.policies.findIndex((p) => p.id === policyId);
    if (policyIndex === -1) return null;

    if (finding.id.startsWith('shadow-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, enforcement: false } : p
      );
      return next;
    }

    if (finding.id.startsWith('missing-log-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, logging: true } : p
      );
      return next;
    }

    if (finding.id.startsWith('missing-log-allow-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, logging: true } : p
      );
      return next;
    }

    if (finding.id.startsWith('webgroup-egress-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, dstGroupId: 'sg-internet' } : p
      );
      return next;
    }

    if (finding.id.startsWith('tls-decrypt-port-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, ports: '443' } : p
      );
      return next;
    }

    if (finding.id.startsWith('tls-decrypt-proto-')) {
      next.policies = next.policies.map((p) =>
        p.id === policyId ? { ...p, protocol: 'tcp' } : p
      );
      return next;
    }

    if (finding.id.startsWith('mergeable-')) {
      const ids = new Set(finding.affectedPolicyIds ?? []);
      const bucket = next.policies.filter((p) => ids.has(p.id));
      if (bucket.length < 2) return null;
      const sorted = [...bucket].sort((a, b) => a.priority - b.priority);
      const keeper = sorted[0]!;
      const portsUnion = Array.from(
        new Set(
          bucket.flatMap((p) => (p.ports ? p.ports.split(',').map((s) => s.trim()) : []))
        )
      ).filter(Boolean);
      next.policies = next.policies
        .filter((p) => !ids.has(p.id) || p.id === keeper.id)
        .map((p) => (p.id === keeper.id ? { ...p, ports: portsUnion.join(',') } : p));
      return next;
    }

    if (finding.id.startsWith('duplicate-name-')) {
      const nameCounts = new Map<string, number>();
      next.policies = next.policies.map((p) => {
        const count = nameCounts.get(p.name) || 0;
        nameCounts.set(p.name, count + 1);
        if (count > 0) {
          return { ...p, name: `${p.name} (${count + 1})` };
        }
        return p;
      });
      return next;
    }

    if (finding.id.startsWith('duplicate-priority-')) {
      const seen = new Set<number>();
      next.policies = next.policies.map((p) => {
        let priority = p.priority;
        while (seen.has(priority)) {
          priority += 1;
        }
        seen.add(priority);
        return { ...p, priority };
      });
      return next;
    }
  }

  return null;
}
