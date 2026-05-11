import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { reorderPolicies } from './reorderPolicies';

function topologyWith(policies: DcfPolicy[]): DcfPolicyModel {
  return {
    smartGroups: [],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies,
    flows: [],
  };
}

function policy(id: string, priority: number): DcfPolicy {
  return {
    id, name: id, priority,
    srcGroupId: 'sg-any', dstGroupId: 'sg-any',
    action: 'allow', protocol: 'tcp', logging: false,
  };
}

describe('reorderPolicies', () => {
  it('renumbers to a 10-step ladder starting at 100', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200), policy('c', 75)]);
    const next = reorderPolicies(t, ['c', 'a', 'b']);
    expect(next.policies.find((p) => p.id === 'c')!.priority).toBe(100);
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(110);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(120);
  });

  it('preserves all non-priority fields', () => {
    const a = policy('a', 50);
    a.name = 'My Allow';
    a.ports = '443';
    a.decrypt = true;
    const t = topologyWith([a, policy('b', 200)]);
    const next = reorderPolicies(t, ['b', 'a']);
    const movedA = next.policies.find((p) => p.id === 'a')!;
    expect(movedA.name).toBe('My Allow');
    expect(movedA.ports).toBe('443');
    expect(movedA.decrypt).toBe(true);
    expect(movedA.priority).toBe(110);
  });

  it('appends policies that are missing from orderedIds at the end of the ladder', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200), policy('c', 75)]);
    const next = reorderPolicies(t, ['b']); // a and c missing
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(100);
    const tailPriorities = ['a', 'c']
      .map((id) => next.policies.find((p) => p.id === id)!.priority)
      .sort((x, y) => x - y);
    expect(tailPriorities).toEqual([110, 120]);
  });

  it('ignores ids in orderedIds that no longer exist', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200)]);
    const next = reorderPolicies(t, ['ghost', 'a', 'b']);
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(100);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(110);
  });

  it('does not mutate the input topology', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200)]);
    const beforeJson = JSON.stringify(t);
    reorderPolicies(t, ['b', 'a']);
    expect(JSON.stringify(t)).toBe(beforeJson);
  });
});
