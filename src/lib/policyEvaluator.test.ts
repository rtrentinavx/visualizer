import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { evaluateTopology, applyAutoFix } from './policyEvaluator';

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
    t.policies[0] = { ...t.policies[0], enforcement: false };
    expect(findingsWithIdPrefix(t, `no-enforcement-${t.policies[0].id}`)).toHaveLength(1);
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
    t.policies[0] = { ...t.policies[0], webGroupIds: ['wg-1'], dstGroupId: 'sg-internet' };
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
    t.policies[0] = { ...t.policies[0], threatGroup: 'tg-1' };
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
    t.policies[0] = { ...t.policies[0], geoGroup: 'gg-1' };
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
