import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel, TrafficFlow } from '../types/dcf';
import { evaluateFlow, compareImpact, withPolicyChange } from './policyImpact';

function topologyWith(policies: DcfPolicy[], flows: TrafficFlow[] = []): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
      { id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' },
      { id: 'sg-app', name: 'App', color: '#10b981', criteria: [], matchType: 'any' },
    ],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies,
    flows,
  };
}

const flowWebToApp443: TrafficFlow = {
  id: 'f1', srcGroupId: 'sg-web', dstGroupId: 'sg-app', protocol: 'tcp', port: 443,
  bytes: 0, packets: 0, allowed: true, timestamp: '2026-01-01T00:00:00Z',
};

describe('evaluateFlow', () => {
  it('returns implicit-deny when no policy matches', () => {
    const t = topologyWith([]);
    const r = evaluateFlow(t, flowWebToApp443);
    expect(r.action).toBe('implicit-deny');
    expect(r.policyId).toBeNull();
  });

  it('returns the matching policy when one applies', () => {
    const allow: DcfPolicy = {
      id: 'p-allow', name: 'allow', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', ports: '443', logging: true,
    };
    const t = topologyWith([allow]);
    const r = evaluateFlow(t, flowWebToApp443);
    expect(r.action).toBe('allow');
    expect(r.policyId).toBe('p-allow');
  });

  it('first-match-wins by priority', () => {
    const denyFirst: DcfPolicy = {
      id: 'p-deny-first', name: 'deny first', priority: 50,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'deny',
      protocol: 'any', logging: true,
    };
    const allowLater: DcfPolicy = {
      id: 'p-allow-later', name: 'allow later', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', ports: '443', logging: true,
    };
    const t = topologyWith([denyFirst, allowLater]);
    const r = evaluateFlow(t, flowWebToApp443);
    expect(r.policyId).toBe('p-deny-first');
    expect(r.action).toBe('deny');
  });

  it('skips policies with enforcement disabled', () => {
    const off: DcfPolicy = {
      id: 'p-off', name: 'off', priority: 50,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'deny',
      protocol: 'any', logging: true, enforcement: false,
    };
    const allow: DcfPolicy = {
      id: 'p-allow', name: 'allow', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', ports: '443', logging: true,
    };
    const t = topologyWith([off, allow]);
    const r = evaluateFlow(t, flowWebToApp443);
    expect(r.policyId).toBe('p-allow');
  });

  it('honors exclude groups', () => {
    const allow: DcfPolicy = {
      id: 'p-allow', name: 'allow', priority: 100,
      srcGroupId: 'sg-any', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'any', logging: true,
      srcExcludeGroupIds: ['sg-web'],
    };
    const t = topologyWith([allow]);
    const r = evaluateFlow(t, flowWebToApp443);
    // sg-web is excluded from sg-any → no match → implicit deny
    expect(r.action).toBe('implicit-deny');
  });
});

describe('compareImpact', () => {
  it('flags flows whose outcome changes between two topologies', () => {
    const baseAllow: DcfPolicy = {
      id: 'p1', name: 'allow', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', ports: '443', logging: true,
    };
    const before = topologyWith([baseAllow], [flowWebToApp443]);
    const flippedToDeny: DcfPolicy = { ...baseAllow, action: 'deny' };
    const after = topologyWith([flippedToDeny], [flowWebToApp443]);

    const impact = compareImpact(before, after, [flowWebToApp443]);
    expect(impact).toHaveLength(1);
    expect(impact[0]!.outcomeChanged).toBe(true);
    expect(impact[0]!.beforeAction).toBe('allow');
    expect(impact[0]!.afterAction).toBe('deny');
    expect(impact[0]!.matchChanged).toBe(false); // same policy id still matches
  });

  it('flags matchChanged when a different policy starts matching after edits', () => {
    const p1: DcfPolicy = {
      id: 'p1', name: 'web→app 443', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', ports: '443', logging: true,
    };
    const p2: DcfPolicy = {
      id: 'p2', name: 'fallback allow any', priority: 9000,
      srcGroupId: 'sg-any', dstGroupId: 'sg-any', action: 'allow',
      protocol: 'any', logging: true,
    };
    const before = topologyWith([p1, p2], [flowWebToApp443]);
    const after = topologyWith([p2], [flowWebToApp443]); // p1 deleted

    const impact = compareImpact(before, after, [flowWebToApp443]);
    expect(impact[0]!.beforePolicyId).toBe('p1');
    expect(impact[0]!.afterPolicyId).toBe('p2');
    expect(impact[0]!.matchChanged).toBe(true);
    expect(impact[0]!.outcomeChanged).toBe(false); // both allow
  });
});

describe('withPolicyChange', () => {
  it('upsert replaces an existing policy by id', () => {
    const p: DcfPolicy = {
      id: 'p1', name: 'allow', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', logging: true,
    };
    const t = topologyWith([p]);
    const edited: DcfPolicy = { ...p, action: 'deny' };
    const next = withPolicyChange(t, edited, 'upsert');
    expect(next.policies).toHaveLength(1);
    expect(next.policies[0]!.action).toBe('deny');
  });

  it('upsert inserts when the policy id is not present', () => {
    const t = topologyWith([]);
    const p: DcfPolicy = {
      id: 'new', name: 'new', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', logging: true,
    };
    const next = withPolicyChange(t, p, 'upsert');
    expect(next.policies).toHaveLength(1);
    expect(next.policies[0]!.id).toBe('new');
  });

  it('delete removes the policy by id', () => {
    const p: DcfPolicy = {
      id: 'p1', name: 'allow', priority: 100,
      srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow',
      protocol: 'tcp', logging: true,
    };
    const t = topologyWith([p]);
    const next = withPolicyChange(t, p, 'delete');
    expect(next.policies).toHaveLength(0);
  });
});
