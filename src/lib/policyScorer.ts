import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';

export interface PolicyScore {
  total: number;
  naming: number;
  specificity: number;
  security: number;
  priority: number;
  logging: number;
  grade: 'F' | 'D' | 'C' | 'B' | 'A' | 'S';
  color: string;
  tips: string[];
}

const GRADES: { min: number; grade: PolicyScore['grade']; color: string }[] = [
  { min: 90, grade: 'S', color: '#a855f7' },
  { min: 75, grade: 'A', color: '#22c55e' },
  { min: 60, grade: 'B', color: '#eab308' },
  { min: 40, grade: 'C', color: '#f97316' },
  { min: 20, grade: 'D', color: '#ef4444' },
  { min: 0, grade: 'F', color: '#dc2626' },
];

function getGrade(total: number): { grade: PolicyScore['grade']; color: string } {
  for (const g of GRADES) {
    if (total >= g.min) return { grade: g.grade, color: g.color };
  }
  return { grade: 'F', color: '#dc2626' };
}

/**
 * Score an individual policy (0-100).
 */
export function scorePolicy(policy: DcfPolicy, topology: DcfPolicyModel): PolicyScore {
  const tips: string[] = [];

  // ---- Naming (0-20) ----
  let naming = 0;
  const name = policy.name.trim();
  const genericNames = ['new policy', 'policy', 'allow', 'deny', 'rule', 'untitled'];
  const isGeneric = genericNames.some((g) => name.toLowerCase().includes(g));
  if (name.length >= 5 && !isGeneric) {
    naming = 20;
  } else if (name.length >= 3 && !isGeneric) {
    naming = 12;
    tips.push('Give the policy a more descriptive name (e.g. "Allow-Web-to-App-HTTPS").');
  } else {
    naming = 5;
    tips.push('Policy name is too generic. Use a descriptive name that explains intent.');
  }

  // ---- Specificity (0-25) ----
  let specificity = 0;
  const usesSpecificSrc = policy.srcGroupId !== 'sg-any';
  const usesSpecificDst = policy.dstGroupId !== 'sg-any';
  const usesSpecificProto = policy.protocol !== 'any';
  const usesSpecificPorts = policy.ports && policy.ports !== 'any';

  if (usesSpecificSrc) specificity += 7;
  else tips.push('Using "Any" as source is broad. Consider a specific SmartGroup.');

  if (usesSpecificDst) specificity += 7;
  else tips.push('Using "Any" as destination is broad. Consider a specific SmartGroup.');

  if (usesSpecificProto) specificity += 6;
  else tips.push('Protocol is "Any". Narrowing to TCP/UDP/ICMP improves security.');

  if (usesSpecificPorts) specificity += 5;
  else tips.push('No specific ports defined. Consider restricting to required ports.');

  // ---- Security (0-25) ----
  let security = 0;
  const isDeny = policy.action === 'deny';
  const isAllow = policy.action === 'allow';
  const isOverlyPermissive = isAllow && policy.srcGroupId === 'sg-any' && policy.dstGroupId === 'sg-any';
  const isInternetFacing = isAllow && (policy.srcGroupId === 'sg-internet' || policy.dstGroupId === 'sg-internet');
  const hasThreatOrGeo = !!policy.threatGroup || !!policy.geoGroup;

  if (isDeny) {
    security += 15;
    if (policy.logging) security += 10;
    else tips.push('Deny policies should have logging enabled for auditability.');
  } else if (isAllow) {
    if (isOverlyPermissive) {
      security += 0;
      tips.push('CRITICAL: Allow-any-to-any is extremely dangerous.');
    } else {
      security += 15;
      if (isInternetFacing && !hasThreatOrGeo) {
        security -= 5;
        tips.push('Internet-facing allow policies benefit from ThreatGroup or GeoGroup protection.');
      }
      if (usesSpecificProto && usesSpecificPorts) {
        security += 10;
      } else {
        security += 5;
        tips.push('Tighten protocol and ports to reduce attack surface.');
      }
    }
  } else {
    // learned
    security = 15;
  }

  // ---- Priority (0-15) ----
  let priority = 15;
  const shadows = topology.policies.filter((p) => {
    if (p.id === policy.id) return false;
    if (p.priority >= policy.priority) return false;
    const sameSrc = p.srcGroupId === policy.srcGroupId || p.srcGroupId === 'sg-any' || policy.srcGroupId === 'sg-any';
    const sameDst = p.dstGroupId === policy.dstGroupId || p.dstGroupId === 'sg-any' || policy.dstGroupId === 'sg-any';
    const sameProto = p.protocol === policy.protocol || p.protocol === 'any' || policy.protocol === 'any';
    return sameSrc && sameDst && sameProto;
  });
  if (shadows.length > 0) {
    priority = 5;
    tips.push(`This policy is shadowed by ${shadows.length} higher-priority rule(s). It may never match.`);
  }

  // ---- Logging (0-15) ----
  let logging = policy.logging ? 15 : 0;
  if (!policy.logging) {
    tips.push('Enable logging for visibility and auditability.');
  }

  const total = naming + specificity + security + priority + logging;
  const { grade, color } = getGrade(total);

  return { total, naming, specificity, security, priority, logging, grade, color, tips };
}

/**
 * Score the entire topology (average of policy scores, plus bonuses).
 */
export function scoreTopology(topology: DcfPolicyModel): {
  average: number;
  totalPolicies: number;
  scoredPolicies: number;
  grade: PolicyScore['grade'];
  color: string;
} {
  if (topology.policies.length === 0) {
    return { average: 0, totalPolicies: 0, scoredPolicies: 0, grade: 'F', color: '#dc2626' };
  }

  const scores = topology.policies.map((p) => scorePolicy(p, topology));
  const average = Math.round(scores.reduce((s, p) => s + p.total, 0) / scores.length);
  const { grade, color } = getGrade(average);

  return {
    average,
    totalPolicies: topology.policies.length,
    scoredPolicies: scores.length,
    grade,
    color,
  };
}
