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
    srcGroupId: ['sg-any'], dstGroupId: ['sg-any'],
    action: 'allow', protocol: 'tcp', logging: false,
  };
}

describe('reorderPolicies', () => {
  it('preserves original priority when it is already valid (≥ prev + 10)', () => {
    // All gaps ≥ 10 in the requested order → all values kept unchanged.
    const t = topologyWith([policy('a', 100), policy('b', 5000), policy('c', 8800)]);
    const next = reorderPolicies(t, ['a', 'b', 'c']);
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(100);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(5000);
    expect(next.policies.find((p) => p.id === 'c')!.priority).toBe(8800);
  });

  it('bumps a priority by exactly 10 when it conflicts with its predecessor', () => {
    // a=100 is fine; b=5000 is fine; c=5005 conflicts (gap=5 < 10) → bumped to 5010.
    const t = topologyWith([policy('a', 100), policy('b', 5000), policy('c', 5005)]);
    const next = reorderPolicies(t, ['a', 'b', 'c']);
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(100);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(5000);
    expect(next.policies.find((p) => p.id === 'c')!.priority).toBe(5010);
  });

  it('cascades bumps when multiple consecutive policies conflict', () => {
    // Drag high-numbered policy to front forces all later policies upward.
    // b=8800 at position 0; then a=5010, c=5000, d=8100 all conflict in sequence.
    const t = topologyWith([policy('a', 5010), policy('b', 8800), policy('c', 5000), policy('d', 8100)]);
    const next = reorderPolicies(t, ['b', 'a', 'c', 'd']);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(8800); // kept
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(8810); // bumped
    expect(next.policies.find((p) => p.id === 'c')!.priority).toBe(8820); // bumped
    expect(next.policies.find((p) => p.id === 'd')!.priority).toBe(8830); // bumped
  });

  it('preserves all non-priority fields', () => {
    const a = policy('a', 5000);
    a.name = 'My Allow';
    a.ports = '443';
    a.decrypt = true;
    const t = topologyWith([a, policy('b', 200)]);
    const next = reorderPolicies(t, ['b', 'a']);
    const movedA = next.policies.find((p) => p.id === 'a')!;
    expect(movedA.name).toBe('My Allow');
    expect(movedA.ports).toBe('443');
    expect(movedA.decrypt).toBe(true);
    // b=200 kept; a=5000 → also kept since 5000 ≥ 200+10
    expect(movedA.priority).toBe(5000);
  });

  it('appends policies missing from orderedIds at the end using keep-or-bump', () => {
    // b=200 is ordered; a=50 and c=75 are tail.
    const t = topologyWith([policy('a', 50), policy('b', 200), policy('c', 75)]);
    const next = reorderPolicies(t, ['b']);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(200);
    // a=50 < 200+10=210 → bumped to 210; c=75 < 220 → bumped to 220
    const tailPriorities = ['a', 'c']
      .map((id) => next.policies.find((p) => p.id === id)!.priority)
      .sort((x, y) => x - y);
    expect(tailPriorities).toEqual([210, 220]);
  });

  it('ignores ids in orderedIds that no longer exist', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200)]);
    const next = reorderPolicies(t, ['ghost', 'a', 'b']);
    // a=50 ≥ 10 → kept 50; b=200 ≥ 60 → kept 200
    expect(next.policies.find((p) => p.id === 'a')!.priority).toBe(50);
    expect(next.policies.find((p) => p.id === 'b')!.priority).toBe(200);
  });

  it('does not mutate the input topology', () => {
    const t = topologyWith([policy('a', 50), policy('b', 200)]);
    const beforeJson = JSON.stringify(t);
    reorderPolicies(t, ['b', 'a']);
    expect(JSON.stringify(t)).toBe(beforeJson);
  });
});
