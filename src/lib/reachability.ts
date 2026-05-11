import type { DcfPolicy, DcfPolicyModel, Protocol, WebGroup, SmartGroup } from '../types/dcf';

export type ReachabilityOutcome = 'allow' | 'deny' | 'learned' | 'implicit-deny';

/** What the AI extracted, after we resolved names to live ids. */
export interface ResolvedReachabilityIntent {
  srcGroup: SmartGroup;        // resolved source SmartGroup (may be the special sg-any)
  dstGroup?: SmartGroup;       // resolved SmartGroup destination, if not a WebGroup destination
  dstWebGroup?: WebGroup;      // resolved WebGroup destination (SaaS FQDN destination)
  isInternet: boolean;         // user asked about generic internet — dst === sg-internet
  protocol: Protocol;
  port?: number;
}

export interface ReachabilityResolutionError {
  reason: string;
  unresolvedNames: string[];
}

export interface ReachabilityVerdict {
  outcome: ReachabilityOutcome;
  matchedPolicy: DcfPolicy | null;
  consideredPolicies: DcfPolicy[]; // all matching, lowest priority first
  explanation: string;
}

/**
 * Resolve AI-supplied names against the live topology. Names are matched
 * case-insensitively (the AI is asked to match exactly, but real users type
 * casual case). Returns either a resolved intent or a structured error
 * describing which names didn't match.
 */
export function resolveIntent(
  topology: DcfPolicyModel,
  raw: {
    srcGroupName?: string;
    dstGroupName?: string;
    dstWebGroupName?: string;
    isInternet?: boolean;
    protocol?: Protocol;
    port?: number;
  },
): ResolvedReachabilityIntent | ReachabilityResolutionError {
  const unresolved: string[] = [];

  // Source: default to sg-any if not specified, or if the user said "Any".
  const srcName = raw.srcGroupName?.trim();
  let srcGroup: SmartGroup | undefined;
  if (!srcName || srcName.toLowerCase() === 'any') {
    srcGroup = topology.smartGroups.find((g) => g.id === 'sg-any');
  } else {
    srcGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === srcName.toLowerCase());
    if (!srcGroup) unresolved.push(`SmartGroup "${srcName}" (source)`);
  }

  // Destination: webgroup wins over smartgroup wins over internet.
  let dstGroup: SmartGroup | undefined;
  let dstWebGroup: WebGroup | undefined;
  let isInternet = raw.isInternet ?? false;

  const dstWgName = raw.dstWebGroupName?.trim();
  if (dstWgName) {
    dstWebGroup = topology.webGroups.find((g) => g.name.toLowerCase() === dstWgName.toLowerCase());
    if (!dstWebGroup) unresolved.push(`WebGroup "${dstWgName}" (destination)`);
    // A WebGroup destination implies internet (Aviatrix L7 filtering targets
    // the internet pseudo-group).
    isInternet = true;
  } else {
    const dstName = raw.dstGroupName?.trim();
    if (dstName && dstName.toLowerCase() !== 'any') {
      if (dstName.toLowerCase() === 'internet') {
        dstGroup = topology.smartGroups.find((g) => g.id === 'sg-internet');
        isInternet = true;
      } else {
        dstGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === dstName.toLowerCase());
        if (!dstGroup) unresolved.push(`SmartGroup "${dstName}" (destination)`);
      }
    } else if (isInternet) {
      dstGroup = topology.smartGroups.find((g) => g.id === 'sg-internet');
    } else {
      dstGroup = topology.smartGroups.find((g) => g.id === 'sg-any');
    }
  }

  if (!srcGroup || (!dstGroup && !dstWebGroup)) {
    unresolved.push('(missing required source or destination)');
  }

  if (unresolved.length > 0) {
    return {
      reason: 'One or more groups in the question could not be matched to your topology.',
      unresolvedNames: unresolved,
    };
  }

  return {
    srcGroup: srcGroup!,
    dstGroup,
    dstWebGroup,
    isInternet,
    protocol: raw.protocol ?? 'tcp',
    port: raw.port,
  };
}

function matchesSrc(p: DcfPolicy, srcId: string): boolean {
  if (p.srcGroupId !== srcId && p.srcGroupId !== 'sg-any') return false;
  if (p.srcExcludeGroupIds?.includes(srcId)) return false;
  return true;
}

function matchesDst(p: DcfPolicy, intent: ResolvedReachabilityIntent): boolean {
  if (intent.dstWebGroup) {
    // WebGroup destination: only policies targeting internet apply. If the
    // policy attaches WebGroups, the target webgroup must be among them; if
    // it attaches none, the policy is a broader internet allow that still
    // covers this destination.
    if (p.dstGroupId !== 'sg-internet' && p.dstGroupId !== 'sg-any') return false;
    if (p.webGroupIds && p.webGroupIds.length > 0 && !p.webGroupIds.includes(intent.dstWebGroup.id)) return false;
    return true;
  }
  if (intent.dstGroup) {
    if (p.dstGroupId !== intent.dstGroup.id && p.dstGroupId !== 'sg-any') return false;
    if (p.dstExcludeGroupIds?.includes(intent.dstGroup.id)) return false;
    return true;
  }
  return false;
}

function matchesProtoPort(p: DcfPolicy, protocol: Protocol, port?: number): boolean {
  if (p.protocol !== protocol && p.protocol !== 'any') return false;
  if (p.ports && p.ports !== 'any') {
    if (port === undefined) {
      // The user didn't specify a port — only "any" ports policies and protocol
      // matches without port constraint apply. A policy that requires :443 isn't
      // a useful match for a portless question.
      return false;
    }
    const policyPorts = p.ports.split(',').map((s) => s.trim());
    if (!policyPorts.includes(String(port))) return false;
  }
  return true;
}

export function checkReachability(topology: DcfPolicyModel, intent: ResolvedReachabilityIntent): ReachabilityVerdict {
  const candidates = topology.policies.filter((p) => {
    if (p.enforcement === false) return false;
    if (!matchesSrc(p, intent.srcGroup.id)) return false;
    if (!matchesDst(p, intent)) return false;
    if (!matchesProtoPort(p, intent.protocol, intent.port)) return false;
    return true;
  });

  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
  const winner = sorted[0];

  if (!winner) {
    return {
      outcome: 'implicit-deny',
      matchedPolicy: null,
      consideredPolicies: [],
      explanation: 'No policy matches this traffic. With Aviatrix\'s default-deny posture, traffic without an explicit allow is dropped.',
    };
  }

  const dstLabel = intent.dstWebGroup?.name ?? intent.dstGroup?.name ?? 'unknown';
  const portLabel = intent.port !== undefined ? `${intent.protocol}/${intent.port}` : intent.protocol;
  const verb = winner.action === 'allow' ? 'is allowed' : winner.action === 'deny' ? 'is denied' : `falls under "${winner.action}"`;
  const shadowNote = sorted.length > 1
    ? ` ${sorted.length - 1} other lower-priority polic${sorted.length - 1 === 1 ? 'y' : 'ies'} also match but are shadowed.`
    : '';

  return {
    outcome: winner.action,
    matchedPolicy: winner,
    consideredPolicies: sorted,
    explanation: `Traffic from "${intent.srcGroup.name}" to "${dstLabel}" over ${portLabel} ${verb} by policy "${winner.name}" (priority ${winner.priority}).${shadowNote}`,
  };
}
