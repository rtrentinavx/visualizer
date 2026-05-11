import { describe, it, expect } from 'vitest';
import type { DcfPolicyModel } from '../types/dcf';
import { resolveIpToGroups, simulateTraffic } from './policySimulator';

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

describe('resolveIpToGroups', () => {
  it('returns the group when the IP matches a subnet criterion', () => {
    const topology = emptyTopology();
    topology.smartGroups.push({
      id: 'sg-web',
      name: 'Web',
      color: '#3b82f6',
      criteria: [{ type: 'subnet', cidr: '10.0.0.0/24' }],
      matchType: 'any',
    });

    expect(resolveIpToGroups(topology, '10.0.0.42')).toEqual(['sg-web']);
  });

  it('returns [] for an invalid IPv4 address', () => {
    const topology = emptyTopology();
    expect(resolveIpToGroups(topology, 'not-an-ip')).toEqual([]);
    expect(resolveIpToGroups(topology, '999.0.0.1')).toEqual([]);
  });

  it('silently skips VM-tag criteria (no inventory)', () => {
    const topology = emptyTopology();
    // VM-only group: nothing to resolve from an IP. Should be ignored.
    topology.smartGroups.push({
      id: 'sg-vm-only',
      name: 'VM Only',
      color: '#000000',
      criteria: [{ type: 'vm', key: 'role', operator: 'equals', value: 'web' }],
      matchType: 'any',
    });

    expect(resolveIpToGroups(topology, '10.0.0.5')).toEqual([]);
  });

  it('with matchType "any", matches when any single subnet criterion matches', () => {
    const topology = emptyTopology();
    topology.smartGroups.push({
      id: 'sg-multi',
      name: 'Multi',
      color: '#000',
      criteria: [
        { type: 'subnet', cidr: '10.0.0.0/24' },
        { type: 'subnet', cidr: '192.168.0.0/24' },
      ],
      matchType: 'any',
    });
    expect(resolveIpToGroups(topology, '10.0.0.5')).toEqual(['sg-multi']);
    expect(resolveIpToGroups(topology, '192.168.0.5')).toEqual(['sg-multi']);
    expect(resolveIpToGroups(topology, '172.16.0.5')).toEqual([]);
  });

  it('with matchType "all", every subnet criterion must match', () => {
    const topology = emptyTopology();
    topology.smartGroups.push({
      id: 'sg-strict',
      name: 'Strict',
      color: '#000',
      criteria: [
        { type: 'subnet', cidr: '10.0.0.0/8' },
        { type: 'subnet', cidr: '10.0.0.0/16' },
      ],
      matchType: 'all',
    });
    // 10.0.0.5 is in BOTH supernets → matches
    expect(resolveIpToGroups(topology, '10.0.0.5')).toEqual(['sg-strict']);
    // 10.5.0.5 is in /8 but NOT /16 → no match under "all"
    expect(resolveIpToGroups(topology, '10.5.0.5')).toEqual([]);
  });

  it('never resolves sg-any or sg-internet (load-bearing special IDs)', () => {
    const topology = emptyTopology();
    // Even if these special groups have subnet criteria attached (hypothetical),
    // they must never appear in the resolution result.
    topology.smartGroups[0]!.criteria = [{ type: 'subnet', cidr: '0.0.0.0/0' }];
    topology.smartGroups[1]!.criteria = [{ type: 'subnet', cidr: '0.0.0.0/0' }];

    const result = resolveIpToGroups(topology, '8.8.8.8');
    expect(result).not.toContain('sg-any');
    expect(result).not.toContain('sg-internet');
  });
});

describe('simulateTraffic', () => {
  function topoWith(policies: DcfPolicyModel['policies']): DcfPolicyModel {
    const t = emptyTopology();
    t.smartGroups.push(
      {
        id: 'sg-web',
        name: 'Web',
        color: '#3b82f6',
        criteria: [{ type: 'subnet', cidr: '10.0.0.0/24' }],
        matchType: 'any',
      },
      {
        id: 'sg-app',
        name: 'App',
        color: '#10b981',
        criteria: [{ type: 'subnet', cidr: '10.0.1.0/24' }],
        matchType: 'any',
      },
      {
        id: 'sg-untrusted',
        name: 'Untrusted',
        color: '#000',
        criteria: [{ type: 'subnet', cidr: '10.0.0.99/32' }],
        matchType: 'any',
      },
    );
    t.policies = policies;
    return t;
  }

  it('priority precedence: lower number wins, others are shadowed', () => {
    const topology = topoWith([
      {
        id: 'pol-low',
        name: 'Low priority allow',
        priority: 200,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: true,
      },
      {
        id: 'pol-high',
        name: 'High priority deny',
        priority: 50,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        action: 'deny',
        protocol: 'tcp',
        ports: '443',
        logging: true,
      },
    ]);

    const result = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 443,
    });

    expect(result.matched).toBe(true);
    expect(result.action).toBe('deny');
    expect(result.matchedPolicy?.id).toBe('pol-high');
    expect(result.allCandidates).toHaveLength(2);
    expect(result.allCandidates[0]!.id).toBe('pol-high');
  });

  it('port match: policy is skipped when the port is not in the policy port list', () => {
    const topology = topoWith([
      {
        id: 'pol-1',
        name: 'TCP 443 only',
        priority: 100,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: false,
      },
    ]);

    const noMatch = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 8080,
    });
    expect(noMatch.matched).toBe(false);
    expect(noMatch.action).toBe('implicit-deny');

    const match = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 443,
    });
    expect(match.matched).toBe(true);
  });

  it('protocol match: policy is skipped when protocol differs (and not "any")', () => {
    const topology = topoWith([
      {
        id: 'pol-1',
        name: 'UDP only',
        priority: 100,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        action: 'allow',
        protocol: 'udp',
        logging: false,
      },
    ]);
    const result = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 53,
    });
    expect(result.matched).toBe(false);
    expect(result.action).toBe('implicit-deny');
  });

  it('exclude-group filtering: src in exclude list disqualifies the policy', () => {
    const topology = topoWith([
      {
        id: 'pol-1',
        name: 'Web → App except untrusted',
        priority: 100,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        srcExcludeGroupIds: ['sg-untrusted'],
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: false,
      },
    ]);

    // 10.0.0.99 is in both sg-web (10.0.0.0/24) and sg-untrusted (10.0.0.99/32)
    const result = simulateTraffic(topology, {
      srcIp: '10.0.0.99',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 443,
    });
    expect(result.matched).toBe(false);
    expect(result.action).toBe('implicit-deny');

    // Non-excluded IP from same source group should still match
    const ok = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 443,
    });
    expect(ok.matched).toBe(true);
    expect(ok.action).toBe('allow');
  });

  it('no-match path returns implicit-deny with no matched policy', () => {
    const topology = topoWith([]);
    const result = simulateTraffic(topology, {
      srcIp: '10.0.0.5',
      dstIp: '10.0.1.5',
      protocol: 'tcp',
      port: 443,
    });
    expect(result.matched).toBe(false);
    expect(result.action).toBe('implicit-deny');
    expect(result.matchedPolicy).toBeNull();
    expect(result.allCandidates).toEqual([]);
  });

  it('sg-any fallback: a policy with srcGroupId sg-any matches even when IP resolves to no group', () => {
    const topology = topoWith([
      {
        id: 'pol-any',
        name: 'Allow any → any',
        priority: 100,
        srcGroupId: 'sg-any',
        dstGroupId: 'sg-any',
        action: 'allow',
        protocol: 'any',
        logging: false,
      },
    ]);

    // Both IPs are not in any defined subnet → resolvedSrc/dst are empty,
    // simulator still adds sg-any and the policy matches.
    const result = simulateTraffic(topology, {
      srcIp: '203.0.113.10',
      dstIp: '198.51.100.20',
      protocol: 'tcp',
      port: 80,
    });
    expect(result.matched).toBe(true);
    expect(result.matchedPolicy?.id).toBe('pol-any');
    expect(result.srcGroups).toEqual([]);
    expect(result.dstGroups).toEqual([]);
  });
});
