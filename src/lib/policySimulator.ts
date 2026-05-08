import type { DcfPolicyModel, DcfPolicy, Protocol } from '../types/dcf';

export interface SimulationRequest {
  srcGroupId: string;
  dstGroupId: string;
  protocol: Protocol;
  port: number;
}

export interface SimulationResult {
  matched: boolean;
  action: 'allow' | 'deny' | 'learned' | 'implicit-deny';
  matchedPolicy: DcfPolicy | null;
  allCandidates: DcfPolicy[];
  explanation: string;
}

/**
 * Evaluate which policy would match for a hypothetical traffic flow.
 * Policies are evaluated in priority order (ascending).
 */
export function simulateTraffic(topology: DcfPolicyModel, request: SimulationRequest): SimulationResult {
  const { srcGroupId, dstGroupId, protocol, port } = request;

  // Filter policies that could match this flow
  const candidates = topology.policies.filter((p) => {
    // Source match
    const srcMatch = p.srcGroupId === srcGroupId || p.srcGroupId === 'sg-any';
    if (!srcMatch) return false;

    // Destination match
    const dstMatch = p.dstGroupId === dstGroupId || p.dstGroupId === 'sg-any';
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
    if (p.srcExcludeGroupIds && p.srcExcludeGroupIds.includes(srcGroupId)) return false;
    if (p.dstExcludeGroupIds && p.dstExcludeGroupIds.includes(dstGroupId)) return false;

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
    };
  }

  const winner = sorted[0];
  const actionText = winner.action === 'allow' ? 'allowed' : 'denied';

  let explanation = `Policy "${winner.name}" (priority ${winner.priority}) matches first and traffic is ${actionText}.`;
  if (sorted.length > 1) {
    explanation += ` ${sorted.length - 1} other lower-priority polic${sorted.length - 1 === 1 ? 'y' : 'ies'} would also match but are shadowed.`;
  }

  return {
    matched: true,
    action: winner.action,
    matchedPolicy: winner,
    allCandidates: sorted,
    explanation,
  };
}
