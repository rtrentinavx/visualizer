import { describe, it, expect } from 'vitest';
import type { DcfPolicyModel } from '../types/dcf';
import { scoreTopology } from './policyScorer';

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

describe('scoreTopology', () => {
  it('returns 0/F for an empty topology', () => {
    const t = emptyTopology();
    const result = scoreTopology(t);
    expect(result.average).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.totalPolicies).toBe(0);
  });

  it('returns a value in [0, 100]', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    t.policies = [
      {
        id: 'p1',
        name: 'Allow Web Egress HTTPS',
        priority: 100,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-internet',
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: true,
        enforcement: true,
      },
    ];
    const result = scoreTopology(t);
    expect(result.average).toBeGreaterThanOrEqual(0);
    expect(result.average).toBeLessThanOrEqual(100);
  });

  it('a best-practice topology earns a high score', () => {
    const t = emptyTopology();
    t.smartGroups.push(
      { id: 'sg-web', name: 'Web Tier', color: '#3b82f6', criteria: [], matchType: 'any' },
      { id: 'sg-app', name: 'App Tier', color: '#10b981', criteria: [], matchType: 'any' },
    );
    t.threatGroups.push({ id: 'tg-1', name: 'Malware', category: 'malware', entryCount: 1 });
    t.policies = [
      {
        id: 'p-web-to-app',
        name: 'Allow Web Tier to App Tier HTTPS',
        priority: 100,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-app',
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: true,
        enforcement: true,
      },
      {
        id: 'p-deny-bad',
        name: 'Deny Web to Bad Actors',
        priority: 200,
        srcGroupId: 'sg-web',
        dstGroupId: 'sg-internet',
        action: 'deny',
        protocol: 'tcp',
        ports: '443',
        logging: true,
        enforcement: true,
        threatGroup: 'tg-1',
      },
    ];

    const result = scoreTopology(t);
    expect(result.average).toBeGreaterThanOrEqual(75);
    expect(['A', 'S']).toContain(result.grade);
  });

  it('a topology dominated by error-level violations earns a low score', () => {
    const t = emptyTopology();
    t.policies = [
      // Overly permissive allow-any-to-any with no logging, generic name
      {
        id: 'p-bad',
        name: 'rule',
        priority: 100,
        srcGroupId: 'sg-any',
        dstGroupId: 'sg-any',
        action: 'allow',
        protocol: 'any',
        logging: false,
        enforcement: true,
      },
    ];
    const result = scoreTopology(t);
    expect(result.average).toBeLessThan(60);
    expect(['F', 'D', 'C']).toContain(result.grade);
  });
});
