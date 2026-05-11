import type { DcfPolicyModel, DcfPolicy, Protocol } from '../types/dcf';
import { ipInCidr, isValidIPv4 } from './ipUtils';

export interface SimulationRequest {
  srcIp: string;
  dstIp: string;
  protocol: Protocol;
  port: number;
  /** Optional destination FQDN — enables WebGroup matching for SaaS/HTTP destinations. */
  dstFqdn?: string;
  /** Optional override: treat the source or destination IP as belonging to this ThreatGroup id. */
  srcThreatGroupId?: string;
  dstThreatGroupId?: string;
  /** Optional override: treat the source or destination IP as belonging to this GeoGroup id (e.g. CN, RU). */
  srcGeoGroupId?: string;
  dstGeoGroupId?: string;
}

export interface SimulationResult {
  matched: boolean;
  action: 'allow' | 'deny' | 'learned' | 'implicit-deny';
  matchedPolicy: DcfPolicy | null;
  allCandidates: DcfPolicy[];
  explanation: string;
  srcGroups: string[];
  dstGroups: string[];
  /** WebGroup ids whose FQDN list contains the simulated dstFqdn. Empty when no FQDN was provided or no WebGroup matched. */
  matchedWebGroupIds: string[];
}

/**
 * Glob-match a single FQDN pattern (as used in WebGroup configurations) against
 * a literal hostname. `*` matches any sequence of characters including dots, so
 * `*.salesforce.com` matches both `www.salesforce.com` and `login.salesforce.com`.
 * Case-insensitive.
 */
export function matchFqdn(pattern: string, fqdn: string): boolean {
  const escaped = pattern
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters EXCEPT *
    .replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`, 'i');
  return re.test(fqdn.toLowerCase());
}

/**
 * Resolve an IP address to the SmartGroup(s) it belongs to.
 * Only subnet CIDR criteria are evaluated; VM tag criteria require an inventory we don't have.
 */
export function resolveIpToGroups(topology: DcfPolicyModel, ip: string): string[] {
  if (!isValidIPv4(ip)) return [];

  const matched: string[] = [];

  for (const group of topology.smartGroups) {
    if (group.id === 'sg-any') continue; // sg-any is implicit, not resolved
    if (group.id === 'sg-internet') continue; // internet is special

    const criteria = group.criteria || [];
    if (criteria.length === 0) continue;

    const subnetCriteria = criteria.filter((c) => c.type === 'subnet' && c.cidr);
    if (subnetCriteria.length === 0) continue; // Can't resolve VM tags from IP alone

    const matches = subnetCriteria.map((c) => ipInCidr(ip, c.cidr!));

    const groupMatches = group.matchType === 'all'
      ? matches.every(Boolean)
      : matches.some(Boolean);

    if (groupMatches) {
      matched.push(group.id);
    }
  }

  return matched;
}

/**
 * Evaluate which policy would match for a hypothetical traffic flow between two IPs.
 * Policies are evaluated in priority order (ascending).
 */
/**
 * Resolve a destination FQDN to the WebGroup ids whose FQDN patterns match it.
 * Empty when no FQDN was supplied or none of the topology's WebGroups match.
 */
function resolveFqdnToWebGroups(topology: DcfPolicyModel, fqdn: string | undefined): string[] {
  if (!fqdn) return [];
  const matched: string[] = [];
  for (const wg of topology.webGroups) {
    if (wg.fqdns.some((pattern) => matchFqdn(pattern, fqdn))) {
      matched.push(wg.id);
    }
  }
  return matched;
}

export function simulateTraffic(topology: DcfPolicyModel, request: SimulationRequest): SimulationResult {
  const { srcIp, dstIp, protocol, port, dstFqdn, srcThreatGroupId, dstThreatGroupId, srcGeoGroupId, dstGeoGroupId } = request;

  // Resolve IPs to groups
  const srcGroups = resolveIpToGroups(topology, srcIp);
  const dstGroups = resolveIpToGroups(topology, dstIp);
  const matchedWebGroupIds = resolveFqdnToWebGroups(topology, dstFqdn);

  // Always include sg-any as a fallback. If the user provided a dstFqdn,
  // sg-internet is also a valid destination (Aviatrix L7 filtering targets
  // the internet pseudo-group for WebGroup-attached policies).
  const srcGroupIds = srcGroups.length > 0 ? [...srcGroups, 'sg-any'] : ['sg-any'];
  const dstGroupIds = dstGroups.length > 0 ? [...dstGroups, 'sg-any'] : ['sg-any'];
  if (dstFqdn) {
    if (!dstGroupIds.includes('sg-internet')) dstGroupIds.push('sg-internet');
  }

  // Find all policies that could match any combination of src/dst groups
  const candidates = topology.policies.filter((p) => {
    if (p.enforcement === false) return false;

    // Source / destination SmartGroup match
    if (!srcGroupIds.includes(p.srcGroupId)) return false;
    if (!dstGroupIds.includes(p.dstGroupId)) return false;

    // Protocol match
    if (!(p.protocol === protocol || p.protocol === 'any')) return false;

    // Port match
    if (p.ports && p.ports !== 'any') {
      const policyPorts = p.ports.split(',').map((s) => s.trim());
      if (!policyPorts.includes(String(port))) return false;
    }

    // Excludes: if the source/dest resolved to a group that is explicitly excluded, skip
    if (p.srcExcludeGroupIds && p.srcExcludeGroupIds.some((eg) => srcGroupIds.includes(eg))) return false;
    if (p.dstExcludeGroupIds && p.dstExcludeGroupIds.some((eg) => dstGroupIds.includes(eg))) return false;

    // WebGroup match — only applies when the policy attaches at least one
    // WebGroup. With a WebGroup attached, the policy is FQDN-scoped: it
    // matches only if the simulated dstFqdn resolves to one of the attached
    // WebGroups. Without a dstFqdn, the FQDN is unknown — skip the policy.
    if (p.webGroupIds && p.webGroupIds.length > 0) {
      if (!dstFqdn) return false;
      const intersect = p.webGroupIds.some((id) => matchedWebGroupIds.includes(id));
      if (!intersect) return false;
    }

    // ThreatGroup match — same semantics: if the policy attaches a threat
    // group, the simulated traffic must be tagged as belonging to that
    // threat group on either side (Aviatrix matches threat intel on either
    // src or dst). Without an override, the policy is skipped.
    if (p.threatGroup) {
      if (p.threatGroup !== srcThreatGroupId && p.threatGroup !== dstThreatGroupId) return false;
    }

    // GeoGroup match — same shape as threat.
    if (p.geoGroup) {
      if (p.geoGroup !== srcGeoGroupId && p.geoGroup !== dstGeoGroupId) return false;
    }

    return true;
  });

  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);

  if (sorted.length === 0) {
    return {
      matched: false,
      action: 'implicit-deny',
      matchedPolicy: null,
      allCandidates: [],
      explanation: 'No policy matches this traffic flow. Traffic is implicitly denied.',
      srcGroups,
      dstGroups,
      matchedWebGroupIds,
    };
  }

  const winner = sorted[0]!;
  const actionText = winner.action === 'allow' ? 'allowed' : 'denied';

  const srcGroupNames = srcGroups.map((id) => topology.smartGroups.find((g) => g.id === id)?.name || id).join(', ');
  const dstGroupNames = dstGroups.map((id) => topology.smartGroups.find((g) => g.id === id)?.name || id).join(', ');

  let explanation = `Source IP ${srcIp} resolves to group(s): ${srcGroupNames || 'none (using sg-any)'}. `;
  explanation += `Destination IP ${dstIp} resolves to group(s): ${dstGroupNames || 'none (using sg-any)'}. `;
  if (dstFqdn) {
    const wgNames = matchedWebGroupIds.map((id) => topology.webGroups.find((g) => g.id === id)?.name || id).join(', ');
    explanation += `Destination FQDN "${dstFqdn}" resolves to WebGroup(s): ${wgNames || 'none'}. `;
  }
  explanation += `Policy "${winner.name}" (priority ${winner.priority}) matches first and traffic is ${actionText}.`;

  if (sorted.length > 1) {
    explanation += ` ${sorted.length - 1} other lower-priority polic${sorted.length - 1 === 1 ? 'y' : 'ies'} would also match but are shadowed.`;
  }

  return {
    matched: true,
    action: winner.action,
    matchedPolicy: winner,
    allCandidates: sorted,
    explanation,
    srcGroups,
    dstGroups,
    matchedWebGroupIds,
  };
}
