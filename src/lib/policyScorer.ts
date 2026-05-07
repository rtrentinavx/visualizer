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
 * Score an individual policy (0-100) based on Aviatrix DCF best practices.
 * Reference: Aviatrix DCF Rule Configuration Guide
 */
export function scorePolicy(policy: DcfPolicy, topology: DcfPolicyModel): PolicyScore {
  const tips: string[] = [];

  // ---- Naming (0-15) ----
  let naming = 0;
  const name = policy.name.trim();
  const genericNames = ['new policy', 'policy', 'allow', 'deny', 'rule', 'untitled'];
  const isGeneric = genericNames.some((g) => name.toLowerCase().includes(g));
  if (name.length >= 5 && !isGeneric) {
    naming = 15;
  } else if (name.length >= 3 && !isGeneric) {
    naming = 10;
    tips.push('Give the policy a more descriptive name (e.g. "Allow-Web-to-App-HTTPS").');
  } else {
    naming = 3;
    tips.push('Policy name is too generic. Use a descriptive name that explains intent.');
  }

  // ---- Specificity (0-25) ----
  let specificity = 0;
  const usesSpecificSrc = policy.srcGroupId !== 'sg-any';
  const usesSpecificDst = policy.dstGroupId !== 'sg-any';
  const usesSpecificProto = policy.protocol !== 'any';
  const usesSpecificPorts = policy.ports && policy.ports !== 'any';

  if (usesSpecificSrc) specificity += 6;
  else tips.push('Using "Any" as source is broad. Consider a specific SmartGroup (Aviatrix Best Practice).');

  if (usesSpecificDst) specificity += 6;
  else tips.push('Using "Any" as destination is broad. Consider a specific SmartGroup (Aviatrix Best Practice).');

  if (usesSpecificProto) specificity += 6;
  else tips.push('Protocol is "Any". Per Aviatrix guide: separate Layer 4 rules by protocol when possible.');

  if (usesSpecificPorts) specificity += 5;
  else if (policy.webGroupIds && policy.webGroupIds.length > 0) {
    // WebGroup rules don't need explicit ports since they target HTTPS implicitly
    specificity += 5;
  } else {
    tips.push('No specific ports defined. Aviatrix guide: explicitly set ports and protocols.');
  }

  // ---- L7 Compliance (0-10) — Aviatrix Best Practice ----
  let l7Compliance = 10;
  const hasWebGroup = policy.webGroupIds && policy.webGroupIds.length > 0;
  const hasTlsDecrypt = policy.decrypt;

  if (hasWebGroup && policy.direction !== 'outbound') {
    l7Compliance = 0;
    tips.push('CRITICAL: WebGroup rules must be egress-only (outbound). Per Aviatrix guide, L7 web filtering is not supported for East/West traffic.');
  }

  if (hasTlsDecrypt) {
    if (policy.protocol !== 'tcp') {
      l7Compliance = 0;
      tips.push('CRITICAL: TLS Decryption only applies to TCP traffic. Per Aviatrix guide: ensure protocol is TCP.');
    }
    if (!policy.ports || !policy.ports.includes('443')) {
      l7Compliance = 0;
      tips.push('CRITICAL: TLS Decryption only applies to TCP:443 (HTTPS). Per Aviatrix guide: ensure port is 443.');
    }
  }

  // ---- Security (0-25) ----
  let security = 0;
  const isDeny = policy.action === 'deny';
  const isAllow = policy.action === 'allow';
  const isOverlyPermissive = isAllow && policy.srcGroupId === 'sg-any' && policy.dstGroupId === 'sg-any';
  const isInternetFacing = isAllow && (policy.srcGroupId === 'sg-internet' || policy.dstGroupId === 'sg-internet');
  const hasThreatOrGeo = !!policy.threatGroup || !!policy.geoGroup;

  if (isDeny) {
    security += 18;
    if (policy.logging) security += 7;
    else tips.push('Deny policies should have logging enabled for auditability (Aviatrix Best Practice).');
  } else if (isAllow) {
    if (isOverlyPermissive) {
      security += 0;
      tips.push('CRITICAL: Allow-any-to-any violates Aviatrix best practices. Set Post Rules to deny all non-defined items.');
    } else {
      security += 15;
      if (isInternetFacing && !hasThreatOrGeo) {
        security -= 3;
        tips.push('Internet-facing allow policies benefit from ThreatGroup or GeoGroup protection (Aviatrix Best Practice).');
      }
      if (usesSpecificProto && usesSpecificPorts) {
        security += 10;
      } else {
        security += 5;
        tips.push('Tighten protocol and ports to reduce attack surface (Aviatrix Best Practice).');
      }
    }
  } else {
    // learned
    security = 12;
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
    tips.push(`This policy is shadowed by ${shadows.length} higher-priority rule(s). It may never match. Aviatrix guide: rules are first-enforced-match.`);
  }

  // ---- Logging (0-10) ----
  let logging = policy.logging ? 10 : 0;
  if (!policy.logging && isAllow) {
    logging = 3; // partial credit for allow without logging
    tips.push('Enable logging for visibility. Aviatrix guide: configure SIEM as destination for logs.');
  } else if (!policy.logging && isDeny) {
    logging = 0;
    tips.push('CRITICAL: Deny policies must have logging enabled for auditability (Aviatrix Best Practice).');
  }

  // Sum up with L7 compliance included in security bucket for display
  const total = naming + specificity + Math.min(security + l7Compliance, 30) + priority + logging;
  const { grade, color } = getGrade(total);

  return {
    total,
    naming,
    specificity,
    security: Math.min(security + l7Compliance, 30),
    priority,
    logging,
    grade,
    color,
    tips,
  };
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
