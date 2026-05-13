import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { evaluateTopology, applyAutoFix, findL4ShadowingInOrder, applyWebGroupSplit } from './policyEvaluator';

// ---------- Helpers ----------

function emptyTopology(): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
    ],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

function policy(overrides: Partial<DcfPolicy>): DcfPolicy {
  return {
    id: 'p1',
    name: 'Default Test Policy',
    priority: 100,
    srcGroupId: 'sg-web',
    dstGroupId: 'sg-app',
    action: 'allow',
    protocol: 'tcp',
    ports: '443',
    logging: true,
    enforcement: true,
    ...overrides,
  };
}

/** A clean topology: realistic shape, mostly-best-practice, used as the negative-case baseline.
 *  Notes: every check below is designed to NOT fire on this baseline. */
function cleanTopology(): DcfPolicyModel {
  const t = emptyTopology();
  t.smartGroups.push(
    { id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [{ type: 'subnet', cidr: '10.0.0.0/24' }], matchType: 'any' },
    { id: 'sg-app', name: 'App', color: '#10b981', criteria: [{ type: 'subnet', cidr: '10.0.1.0/24' }], matchType: 'any' },
  );
  t.policies = [
    policy({
      id: 'p1',
      name: 'Allow Web to App HTTPS',
      priority: 100,
      srcGroupId: 'sg-web',
      dstGroupId: 'sg-app',
      action: 'allow',
      protocol: 'tcp',
      ports: '443',
      logging: true,
    }),
    policy({
      id: 'p-deny-all',
      name: 'Default Deny All Catch-All',
      priority: 9999,
      srcGroupId: 'sg-any',
      dstGroupId: 'sg-any',
      action: 'deny',
      protocol: 'any',
      ports: undefined,
      logging: true,
    }),
  ];
  return t;
}

function findingsWithIdPrefix(topology: DcfPolicyModel, prefix: string) {
  return evaluateTopology(topology).findings.filter((f) => f.id.startsWith(prefix));
}

// ---------- Per-check tests ----------

describe('findShadowedPolicies', () => {
  it('positive: a lower-priority policy with same src/dst/proto/port is flagged', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'high', name: 'High', priority: 10, srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', ports: '443' }),
      policy({ id: 'low', name: 'Low', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', ports: '443' }),
      // satisfy missing-deny-all (silence unrelated finding)
      policy({ id: 'p-deny', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'shadow-low')).toHaveLength(1);
  });

  it('negative: a topology with one non-overlapping policy has no shadow findings', () => {
    // No deny-all-any-any here, so nothing shadows the single specific rule.
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'only', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', ports: '443' }),
    ];
    expect(findingsWithIdPrefix(t, 'shadow-')).toHaveLength(0);
  });
});

describe('findMissingDenyAll', () => {
  it('positive: topology with policies but no any→any deny fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [policy({ srcGroupId: 'sg-web', dstGroupId: 'sg-web' })];
    expect(findingsWithIdPrefix(t, 'missing-deny-all')).toHaveLength(1);
  });

  it('negative: clean topology has deny-all and no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'missing-deny-all')).toHaveLength(0);
  });
});

describe('findOverlyPermissive', () => {
  it('positive: an allow any→any policy is flagged', () => {
    const t = emptyTopology();
    t.policies = [
      policy({ id: 'too-broad', name: 'Wide open', srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'allow', protocol: 'any', ports: undefined }),
      policy({ id: 'p-deny', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'overly-permissive-too-broad')).toHaveLength(1);
  });

  it('negative: clean topology has no overly-permissive policy', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'overly-permissive-')).toHaveLength(0);
  });
});

describe('findUnusedGroups', () => {
  it('positive: a SmartGroup not referenced by any policy is flagged', () => {
    const t = cleanTopology();
    t.smartGroups.push({ id: 'sg-orphan', name: 'Orphan', color: '#777', criteria: [], matchType: 'any' });
    expect(findingsWithIdPrefix(t, 'unused-group-sg-orphan')).toHaveLength(1);
  });

  it('negative: every SmartGroup is used → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'unused-group-')).toHaveLength(0);
  });
});

describe('findMissingLogging (deny without logging)', () => {
  it('positive: a deny policy with logging:false is flagged', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'silent-deny', action: 'deny', logging: false, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'missing-log-silent-deny')).toHaveLength(1);
  });

  it('negative: clean topology denies always log', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'missing-log-').filter((f) => !f.id.startsWith('missing-log-allow-'))).toHaveLength(0);
  });
});

describe('findMissingThreatProtection', () => {
  it('positive: internet allow without threat/geo group fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'inet', name: 'Inet allow', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'missing-threat-inet')).toHaveLength(1);
  });

  it('negative: same policy with a threatGroup attached → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.threatGroups.push({ id: 'tg-1', name: 'Malware', category: 'malware', entryCount: 1 });
    t.policies = [
      policy({ id: 'inet', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', threatGroup: 'tg-1' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'missing-threat-')).toHaveLength(0);
  });
});

describe('findConflictingActions', () => {
  it('positive: two policies on same src/dst/proto/ports with allow + deny is flagged', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', priority: 100, action: 'allow', protocol: 'tcp', ports: '443', srcGroupId: 'sg-web', dstGroupId: 'sg-app' }),
      policy({ id: 'b', priority: 110, action: 'deny', protocol: 'tcp', ports: '443', srcGroupId: 'sg-web', dstGroupId: 'sg-app' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'conflict-').length).toBeGreaterThanOrEqual(1);
  });

  it('negative: clean topology has no conflicts', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'conflict-')).toHaveLength(0);
  });
});

describe('findWebGroupEgressViolation', () => {
  it('positive: WebGroup-bearing policy whose dst is not sg-internet fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.webGroups.push({ id: 'wg-1', name: 'SaaS', fqdns: ['*.example.com'] });
    t.policies = [
      policy({ id: 'wgrule', srcGroupId: 'sg-web', dstGroupId: 'sg-app', webGroupIds: ['wg-1'] }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'webgroup-egress-wgrule')).toHaveLength(1);
  });

  it('negative: WebGroup-bearing policy with dst=sg-internet → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.webGroups.push({ id: 'wg-1', name: 'SaaS', fqdns: ['*.example.com'] });
    t.policies = [
      policy({ id: 'wgrule', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', webGroupIds: ['wg-1'] }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'webgroup-egress-')).toHaveLength(0);
  });
});

describe('findTlsDecryptPortViolation', () => {
  it('positive: decrypt=true without port 443 fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'tcp', ports: '8443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'tls-decrypt-port-d1')).toHaveLength(1);
  });

  it('negative: decrypt=true with port 443 → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'tcp', ports: '443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'tls-decrypt-port-')).toHaveLength(0);
  });
});

describe('findTlsDecryptProtocolViolation', () => {
  it('positive: decrypt=true with non-tcp protocol fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'udp', ports: '443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'tls-decrypt-proto-d1')).toHaveLength(1);
  });

  it('negative: decrypt=true with protocol=tcp → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'tcp', ports: '443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'tls-decrypt-proto-')).toHaveLength(0);
  });
});

describe('findBroadAllowWithoutPorts', () => {
  it('positive: allow + protocol=any + no ports + no webGroup fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'broad', srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'any', ports: undefined }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'broad-allow-broad')).toHaveLength(1);
  });

  it('negative: explicit ports → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'broad-allow-')).toHaveLength(0);
  });
});

describe('findDuplicateNames', () => {
  it('positive: two policies sharing a name fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', name: 'Same name', srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'b', name: 'Same name', srcGroupId: 'sg-web', dstGroupId: 'sg-web', priority: 101 }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'duplicate-name-Same name')).toHaveLength(1);
  });

  it('negative: unique names → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'duplicate-name-')).toHaveLength(0);
  });
});

describe('findSelfToSelfPolicies', () => {
  it('positive: src === dst (and not sg-any) fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'self', srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'self-to-self-self')).toHaveLength(1);
  });

  it('negative: clean topology (different src/dst) → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'self-to-self-')).toHaveLength(0);
  });
});

describe('findDuplicatePriorities', () => {
  it('positive: two policies sharing a priority fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', name: 'A', priority: 500, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'b', name: 'B', priority: 500, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'duplicate-priority-500')).toHaveLength(1);
  });

  it('negative: distinct priorities → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'duplicate-priority-')).toHaveLength(0);
  });
});

describe('findMissingLoggingOnAllow', () => {
  it('positive: allow policy with logging:false fires (info)', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'quiet', action: 'allow', logging: false, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'missing-log-allow-quiet')).toHaveLength(1);
  });

  it('negative: clean topology (logging:true on allow) → no finding', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'missing-log-allow-')).toHaveLength(0);
  });
});

describe('findLearnedWithoutDenyAll', () => {
  it('positive: learned policy without a deny-all fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'l1', action: 'learned', srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
    ];
    expect(findingsWithIdPrefix(t, 'learned-without-deny-all')).toHaveLength(1);
  });

  it('negative: learned WITH a deny-all → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'l1', action: 'learned', srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'learned-without-deny-all')).toHaveLength(0);
  });
});

describe('findPoliciesWithoutEnforcement', () => {
  it('positive: a policy with enforcement:false fires', () => {
    const t = cleanTopology();
    t.policies[0] = { ...t.policies[0]!, enforcement: false };
    expect(findingsWithIdPrefix(t, `no-enforcement-${t.policies[0]!.id}`)).toHaveLength(1);
  });

  it('negative: clean topology has all policies enforced', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'no-enforcement-')).toHaveLength(0);
  });
});

describe('findHighPriorityBroadRules', () => {
  it('positive: a priority ≤ 50 any→any rule fires', () => {
    const t = emptyTopology();
    t.policies = [
      policy({ id: 'top', priority: 10, srcGroupId: 'sg-any', dstGroupId: 'sg-any' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'high-priority-broad-top')).toHaveLength(1);
  });

  it('negative: clean topology has none', () => {
    expect(findingsWithIdPrefix(cleanTopology(), 'high-priority-broad-')).toHaveLength(0);
  });
});

describe('findUnusedWebGroups', () => {
  it('positive: a WebGroup not referenced by any policy fires', () => {
    const t = cleanTopology();
    t.webGroups.push({ id: 'wg-orphan', name: 'Orphan WG', fqdns: ['*.x.com'] });
    expect(findingsWithIdPrefix(t, 'unused-webgroup-wg-orphan')).toHaveLength(1);
  });

  it('negative: all WebGroups referenced → no finding', () => {
    const t = cleanTopology();
    t.webGroups.push({ id: 'wg-1', name: 'WG One', fqdns: ['*.x.com'] });
    t.policies[0] = { ...t.policies[0]!, webGroupIds: ['wg-1'], dstGroupId: 'sg-internet' };
    expect(findingsWithIdPrefix(t, 'unused-webgroup-')).toHaveLength(0);
  });
});

describe('findUnusedThreatGroups', () => {
  it('positive: a ThreatGroup not referenced fires', () => {
    const t = cleanTopology();
    t.threatGroups.push({ id: 'tg-orphan', name: 'Orphan TG', category: 'malware', entryCount: 1 });
    expect(findingsWithIdPrefix(t, 'unused-threatgroup-tg-orphan')).toHaveLength(1);
  });

  it('negative: all ThreatGroups referenced → no finding', () => {
    const t = cleanTopology();
    t.threatGroups.push({ id: 'tg-1', name: 'TG One', category: 'malware', entryCount: 1 });
    t.policies[0] = { ...t.policies[0]!, threatGroup: 'tg-1' };
    expect(findingsWithIdPrefix(t, 'unused-threatgroup-')).toHaveLength(0);
  });
});

describe('findUnusedGeoGroups', () => {
  it('positive: a GeoGroup not referenced fires', () => {
    const t = cleanTopology();
    t.geoGroups.push({ id: 'gg-orphan', name: 'Orphan GG', countries: ['ZZ'] });
    expect(findingsWithIdPrefix(t, 'unused-geogroup-gg-orphan')).toHaveLength(1);
  });

  it('negative: all GeoGroups referenced → no finding', () => {
    const t = cleanTopology();
    t.geoGroups.push({ id: 'gg-1', name: 'GG One', countries: ['ZZ'] });
    t.policies[0] = { ...t.policies[0]!, geoGroup: 'gg-1' };
    expect(findingsWithIdPrefix(t, 'unused-geogroup-')).toHaveLength(0);
  });
});

describe('findAllowInternetWithoutInspection', () => {
  it('positive: tcp 443 → internet, decrypt off → fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'noins', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', decrypt: false }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'no-inspection-noins')).toHaveLength(1);
  });

  it('negative: same policy with decrypt:true → no finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'noins', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'no-inspection-')).toHaveLength(0);
  });
});

describe('findRedundantPolicies', () => {
  it('positive: narrow policy covered by later same-action broad policy fires', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'narrow', name: 'Web→App 443', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '443' }),
      policy({ id: 'broad', name: 'Web→App any', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'any', ports: undefined }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'redundant-narrow')).toHaveLength(1);
  });

  it('negative: same conditions but different actions → no finding', () => {
    // Note: no catch-all deny in this fixture on purpose. p-deny-all would itself
    // cover `denyany` and (correctly) trigger a redundant-* finding, since the
    // check looks at all policy pairs not just the focused one.
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'allow443', srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '443' }),
      policy({ id: 'denyany', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'deny', protocol: 'any', ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'redundant-')).toHaveLength(0);
  });

  it('negative: broader policy at LOWER priority does not cover (would be shadowed instead)', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'broadFirst', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'any', ports: undefined }),
      policy({ id: 'narrowLater', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '443' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    // narrowLater is shadowed by broadFirst (existing check), not redundant in the new sense.
    expect(findingsWithIdPrefix(t, 'redundant-')).toHaveLength(0);
  });
});

describe('findMergeablePolicies', () => {
  it('positive: two policies differing only in ports fire one mergeable finding', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'p8080', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8080' }),
      policy({ id: 'p8443', priority: 110, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'mergeable-p8080')).toHaveLength(1);
  });

  it('negative: different actions → no merge', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', srcGroupId: 'sg-web', dstGroupId: 'sg-web', action: 'allow', protocol: 'tcp', ports: '8080' }),
      policy({ id: 'b', priority: 110, srcGroupId: 'sg-web', dstGroupId: 'sg-web', action: 'deny', protocol: 'tcp', ports: '8443' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'mergeable-')).toHaveLength(0);
  });

  it('negative: port=any policy is skipped (nothing to combine)', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', srcGroupId: 'sg-web', dstGroupId: 'sg-web', action: 'allow', protocol: 'tcp', ports: 'any' }),
      policy({ id: 'b', priority: 110, srcGroupId: 'sg-web', dstGroupId: 'sg-web', action: 'allow', protocol: 'tcp', ports: 'any' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    expect(findingsWithIdPrefix(t, 'mergeable-')).toHaveLength(0);
  });
});

// ---------- applyAutoFix ----------

describe('applyAutoFix', () => {
  it('missing-deny-all → adds a catch-all deny policy', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [policy({ id: 'p1', srcGroupId: 'sg-web', dstGroupId: 'sg-web' })];

    const before = evaluateTopology(t).findings.find((f) => f.id === 'missing-deny-all');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed).not.toBeNull();
    expect(fixed.policies.some((p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any')).toBe(true);
    expect(evaluateTopology(fixed).findings.some((f) => f.id === 'missing-deny-all')).toBe(false);
  });

  it('learned-without-deny-all → adds a catch-all deny policy', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [policy({ id: 'l1', action: 'learned', srcGroupId: 'sg-web', dstGroupId: 'sg-web' })];

    const before = evaluateTopology(t).findings.find((f) => f.id === 'learned-without-deny-all');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.some((p) => p.action === 'deny' && p.srcGroupId === 'sg-any' && p.dstGroupId === 'sg-any')).toBe(true);
    expect(evaluateTopology(fixed).findings.some((f) => f.id === 'learned-without-deny-all')).toBe(false);
  });

  it('shadow-<id> → disables enforcement on the shadowed policy', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'high', priority: 10, srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', ports: '443' }),
      policy({ id: 'low', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', ports: '443' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'shadow-low');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    const lowPolicy = fixed.policies.find((p) => p.id === 'low')!;
    expect(lowPolicy.enforcement).toBe(false);
  });

  it('missing-log-<id> (deny) → enables logging', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'silent', action: 'deny', logging: false, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'missing-log-silent');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.find((p) => p.id === 'silent')!.logging).toBe(true);
  });

  it('missing-log-allow-<id> → enables logging on the allow policy', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'quiet', action: 'allow', logging: false, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'missing-log-allow-quiet');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.find((p) => p.id === 'quiet')!.logging).toBe(true);
  });

  it('webgroup-egress-<id> → changes destination to sg-internet', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.webGroups.push({ id: 'wg-1', name: 'SaaS', fqdns: ['*.example.com'] });
    t.policies = [
      policy({ id: 'wgrule', srcGroupId: 'sg-web', dstGroupId: 'sg-app', webGroupIds: ['wg-1'] }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'webgroup-egress-wgrule');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.find((p) => p.id === 'wgrule')!.dstGroupId).toBe('sg-internet');
  });

  it('tls-decrypt-port-<id> → sets ports to 443', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'tcp', ports: '8443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'tls-decrypt-port-d1');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.find((p) => p.id === 'd1')!.ports).toBe('443');
  });

  it('tls-decrypt-proto-<id> → sets protocol to tcp', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'd1', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', protocol: 'udp', ports: '443', decrypt: true }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'tls-decrypt-proto-d1');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    expect(fixed.policies.find((p) => p.id === 'd1')!.protocol).toBe('tcp');
  });

  it('duplicate-name-<name> → makes names unique', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', name: 'Dupe', srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'b', name: 'Dupe', srcGroupId: 'sg-web', dstGroupId: 'sg-web', priority: 101 }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'duplicate-name-Dupe');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    const names = fixed.policies.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    // The original finding no longer fires after the fix
    expect(evaluateTopology(fixed).findings.some((f) => f.id === 'duplicate-name-Dupe')).toBe(false);
  });

  it('duplicate-priority-<n> → renumbers to unique priorities', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'a', name: 'A', priority: 500, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'b', name: 'B', priority: 500, srcGroupId: 'sg-web', dstGroupId: 'sg-web' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'duplicate-priority-500');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    const priorities = fixed.policies.map((p) => p.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('mergeable-<id> → consolidates port-differing policies into the lowest-priority one', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.smartGroups.push({ id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' });
    t.policies = [
      policy({ id: 'p8080', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8080' }),
      policy({ id: 'p8443', priority: 110, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443' }),
      policy({ id: 'p-deny-all', name: 'Deny All', priority: 9999, srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'deny', protocol: 'any', logging: true, ports: undefined }),
    ];
    const before = evaluateTopology(t).findings.find((f) => f.id === 'mergeable-p8080');
    expect(before).toBeDefined();
    const fixed = applyAutoFix(t, before!)!;
    const survivors = fixed.policies.filter((p) => p.id === 'p8080' || p.id === 'p8443');
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id).toBe('p8080');
    const survivingPorts = survivors[0]!.ports!.split(',').map((s) => s.trim()).sort();
    expect(survivingPorts).toEqual(['8080', '8443']);
  });

  it('non-fixable finding returns null', () => {
    const t = cleanTopology();
    // Create a synthetic non-fixable finding
    const fakeFinding = {
      id: 'unused-group-sg-foo',
      severity: 'info' as const,
      category: 'hygiene' as const,
      frameworks: ['Best Practice' as const],
      title: 'Unused',
      description: 'unused',
      fixable: false,
    };
    expect(applyAutoFix(t, fakeFinding)).toBeNull();
  });
});

// ---------- L4 deny shadows L7 allow ----------

describe('findL4DenyShadowsL7Allow', () => {
  function topoWithSGs(): DcfPolicyModel {
    const t = emptyTopology();
    t.smartGroups.push(
      { id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [{ type: 'subnet', cidr: '10.0.0.0/24' }], matchType: 'any' },
    );
    t.webGroups.push({ id: 'wg-sfdc', name: 'Salesforce', fqdns: ['*.salesforce.com'] });
    return t;
  }

  it('flags an L7 allow when an earlier pure-L4 deny covers its selector', () => {
    const t = topoWithSGs();
    t.policies = [
      policy({ id: 'p-l4-deny', name: 'Block Web Egress', priority: 50, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443' }),
      policy({ id: 'p-l7-allow', name: 'Allow Web → Salesforce', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] }),
    ];
    const findings = findingsWithIdPrefix(t, 'l4-shadows-l7-');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.affectedPolicyIds).toEqual(['p-l7-allow', 'p-l4-deny']);
    expect(findings[0]!.severity).toBe('warning');
    expect(findings[0]!.category).toBe('security');
  });

  it('does NOT flag when the L7 allow has a LOWER priority number (evaluated first)', () => {
    const t = topoWithSGs();
    t.policies = [
      policy({ id: 'p-l7-allow', name: 'Allow Web → Salesforce', priority: 50, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] }),
      policy({ id: 'p-l4-deny', name: 'Block Web Egress', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443' }),
    ];
    expect(findingsWithIdPrefix(t, 'l4-shadows-l7-')).toHaveLength(0);
  });

  it('does NOT flag when the earlier deny is itself an L7 policy (decrypt or WebGroup)', () => {
    const t = topoWithSGs();
    t.policies = [
      // Earlier deny is L7 (decrypt=true) → doesn't short-circuit at L4.
      policy({ id: 'p-l7-deny', name: 'L7 Block', priority: 50, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443', decrypt: true }),
      policy({ id: 'p-l7-allow', name: 'Allow Web → Salesforce', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] }),
    ];
    expect(findingsWithIdPrefix(t, 'l4-shadows-l7-')).toHaveLength(0);
  });

  it('does NOT flag when the L4 deny excludes the L7 allow\'s src group', () => {
    const t = topoWithSGs();
    t.policies = [
      policy({ id: 'p-l4-deny', name: 'Block Egress (Web excluded)', priority: 50, srcGroupId: 'sg-any', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443', srcExcludeGroupIds: ['sg-web'] }),
      policy({ id: 'p-l7-allow', name: 'Allow Web → Salesforce', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] }),
    ];
    expect(findingsWithIdPrefix(t, 'l4-shadows-l7-')).toHaveLength(0);
  });

  it('does NOT flag when the policy attaches WebGroups but is a DENY (only L7 allows can be "lost")', () => {
    // A blocked-FQDN policy that an L4 deny short-circuits isn't a correctness
    // problem — the FQDN is denied either way. Only L7 ALLOWS matter here.
    const t = topoWithSGs();
    t.policies = [
      policy({ id: 'p-l4-deny', name: 'Block Web Egress', priority: 50, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443' }),
      policy({ id: 'p-l7-deny', name: 'Block Web → Salesforce', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] }),
    ];
    expect(findingsWithIdPrefix(t, 'l4-shadows-l7-')).toHaveLength(0);
  });

  it('findL4ShadowingInOrder operates on the given order, not policy.priority', () => {
    const t = topoWithSGs();
    const l4Deny = policy({ id: 'p-l4', name: 'L4 Deny', priority: 999, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'deny', protocol: 'tcp', ports: '443' });
    const l7Allow = policy({ id: 'p-l7', name: 'L7 Allow', priority: 1, srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow', protocol: 'tcp', ports: '443', webGroupIds: ['wg-sfdc'] });
    t.policies = [l4Deny, l7Allow];

    // By saved priority: L7 allow (1) comes first → not shadowed.
    expect(findingsWithIdPrefix(t, 'l4-shadows-l7-')).toHaveLength(0);

    // But if the reorder modal proposes [L4Deny, L7Allow] → shadowed.
    const proposed = findL4ShadowingInOrder([l4Deny, l7Allow]);
    expect(proposed.get('p-l7')).toBe('p-l4');
  });
});

// ---------- AI-suggested WebGroup split ----------

describe('applyWebGroupSplit', () => {
  function topoWithWideWG(): DcfPolicyModel {
    const t = emptyTopology();
    t.webGroups.push({
      id: 'wg-old',
      name: 'Mixed Allowlist',
      fqdns: ['*.salesforce.com', '*.slack.com', '*.github.com', '*.windowsupdate.com', '*.ubuntu.com'],
    });
    t.policies = [
      policy({ id: 'pol-attaches', name: 'Web Egress', priority: 100, webGroupIds: ['wg-old'] }),
    ];
    return t;
  }

  it('creates new WebGroups, rewrites policy references, removes the original', () => {
    const t = topoWithWideWG();
    const result = applyWebGroupSplit(t, 'wg-old', [
      { name: 'SaaS Apps', fqdns: ['*.salesforce.com', '*.slack.com'] },
      { name: 'Dev Tools', fqdns: ['*.github.com'] },
      { name: 'OS Updates', fqdns: ['*.windowsupdate.com', '*.ubuntu.com'] },
    ]);
    expect(result).not.toBeNull();
    const r = result!;
    // Original gone.
    expect(r.topology.webGroups.find((g) => g.id === 'wg-old')).toBeUndefined();
    // Three new groups present.
    const newGroups = r.topology.webGroups.filter((g) => ['SaaS Apps', 'Dev Tools', 'OS Updates'].includes(g.name));
    expect(newGroups).toHaveLength(3);
    // Policy re-points to ALL three new group ids.
    const updatedPolicy = r.topology.policies.find((p) => p.id === 'pol-attaches')!;
    expect(updatedPolicy.webGroupIds).toHaveLength(3);
    const newIds = new Set(newGroups.map((g) => g.id));
    for (const id of updatedPolicy.webGroupIds!) expect(newIds.has(id)).toBe(true);
    // Summary numbers match.
    expect(r.summary.created).toBe(3);
    expect(r.summary.policiesUpdated).toBe(1);
    expect(r.summary.droppedFqdns).toBe(0);
  });

  it('drops invented (non-original) fqdns from proposed splits — anti-hallucination guard', () => {
    const t = topoWithWideWG();
    const result = applyWebGroupSplit(t, 'wg-old', [
      { name: 'Real', fqdns: ['*.salesforce.com', '*.fake-domain-the-ai-invented.com'] },
      { name: 'Other', fqdns: ['*.slack.com', '*.another-invented.io'] },
    ]);
    expect(result).not.toBeNull();
    const r = result!;
    // Two invented fqdns dropped.
    expect(r.summary.droppedFqdns).toBe(2);
    const real = r.topology.webGroups.find((g) => g.name === 'Real')!;
    const other = r.topology.webGroups.find((g) => g.name === 'Other')!;
    expect(real.fqdns).toEqual(['*.salesforce.com']);
    expect(other.fqdns).toEqual(['*.slack.com']);
  });

  it('drops splits whose fqdns are all invented (resulting empty)', () => {
    const t = topoWithWideWG();
    const result = applyWebGroupSplit(t, 'wg-old', [
      { name: 'AllReal', fqdns: ['*.salesforce.com'] },
      { name: 'AllFake', fqdns: ['*.invented-1.com', '*.invented-2.com'] },
    ]);
    expect(result).not.toBeNull();
    const newWGs = result!.topology.webGroups.filter((g) => g.name === 'AllReal' || g.name === 'AllFake');
    expect(newWGs).toHaveLength(1);
    expect(newWGs[0]!.name).toBe('AllReal');
  });

  it('returns null when the source WebGroup id does not exist', () => {
    const t = topoWithWideWG();
    expect(applyWebGroupSplit(t, 'wg-does-not-exist', [
      { name: 'X', fqdns: ['*.salesforce.com'] },
    ])).toBeNull();
  });

  it('returns null when every proposed split is empty after validation', () => {
    const t = topoWithWideWG();
    expect(applyWebGroupSplit(t, 'wg-old', [
      { name: 'AllInvented', fqdns: ['*.totally-fake.com'] },
    ])).toBeNull();
  });
});
