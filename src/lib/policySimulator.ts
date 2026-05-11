import type { DcfPolicyModel, DcfPolicy, Protocol } from '../types/dcf';
import { ipInCidr, isValidIPv4 } from './ipUtils';

export interface SimulationRequest {
  srcIp: string;
  dstIp: string;
  protocol: Protocol;
  port: number;
}

export interface SimulationResult {
  matched: boolean;
  action: 'allow' | 'deny' | 'learned' | 'implicit-deny';
  matchedPolicy: DcfPolicy | null;
  allCandidates: DcfPolicy[];
  explanation: string;
  srcGroups: string[];
  dstGroups: string[];
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
export function simulateTraffic(topology: DcfPolicyModel, request: SimulationRequest): SimulationResult {
  const { srcIp, dstIp, protocol, port } = request;

  // Resolve IPs to groups
  const srcGroups = resolveIpToGroups(topology, srcIp);
  const dstGroups = resolveIpToGroups(topology, dstIp);

  // Always include sg-any as a fallback
  const srcGroupIds = srcGroups.length > 0 ? [...srcGroups, 'sg-any'] : ['sg-any'];
  const dstGroupIds = dstGroups.length > 0 ? [...dstGroups, 'sg-any'] : ['sg-any'];

  // Find all policies that could match any combination of src/dst groups
  const candidates = topology.policies.filter((p) => {
    // Source match: policy src must be in our resolved groups or sg-any
    const srcMatch = srcGroupIds.includes(p.srcGroupId);
    if (!srcMatch) return false;

    // Destination match
    const dstMatch = dstGroupIds.includes(p.dstGroupId);
    if (!dstMatch) return false;

    // Protocol match
    const protoMatch = p.protocol === protocol || p.protocol === 'any';
    if (!protoMatch) return false;

    // Port match
    if (p.ports && p.ports !== 'any') {
      const policyPorts = p.ports.split(',').map((p) => p.trim());
      const portStr = String(port);
      if (!policyPorts.includes(portStr)) return false;
    }

    // Exclude groups check
    // If the source IP resolved to a group that is explicitly excluded, skip
    if (p.srcExcludeGroupIds && p.srcExcludeGroupIds.some((eg) => srcGroupIds.includes(eg))) return false;
    if (p.dstExcludeGroupIds && p.dstExcludeGroupIds.some((eg) => dstGroupIds.includes(eg))) return false;

    return true;
  });

  // Sort by priority (lower number = higher precedence)
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
    };
  }

  // Guaranteed non-null by the `sorted.length === 0` early return above.
  const winner = sorted[0]!;
  const actionText = winner.action === 'allow' ? 'allowed' : 'denied';

  const srcGroupNames = srcGroups.map((id) => topology.smartGroups.find((g) => g.id === id)?.name || id).join(', ');
  const dstGroupNames = dstGroups.map((id) => topology.smartGroups.find((g) => g.id === id)?.name || id).join(', ');

  let explanation = `Source IP ${srcIp} resolves to group(s): ${srcGroupNames || 'none (using sg-any)'}. `;
  explanation += `Destination IP ${dstIp} resolves to group(s): ${dstGroupNames || 'none (using sg-any)'}. `;
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
  };
}
