import { describe, it, expect } from 'vitest';
import { diffTopologies } from './topologyDiff';
import type { DcfPolicyModel } from '../types/dcf';

function blank(): DcfPolicyModel {
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

describe('diffTopologies', () => {
  it('reports an empty diff when both sides are equal', () => {
    const a = blank();
    const b = blank();
    const d = diffTopologies(a, b);
    expect(d.isEmpty).toBe(true);
    expect(d.totals).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it('ignores sg-any and sg-internet — they are pseudo-groups, not user-edited content', () => {
    const before = blank();
    const after = blank();
    // Even if the pseudo groups have different cosmetic fields between snapshots, the diff
    // shouldn't surface them.
    after.smartGroups[0]!.color = '#000000';
    const d = diffTopologies(before, after);
    expect(d.isEmpty).toBe(true);
  });

  it('detects an added SmartGroup', () => {
    const before = blank();
    const after = blank();
    after.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    const d = diffTopologies(before, after);
    expect(d.smartGroups.added).toHaveLength(1);
    expect(d.smartGroups.added[0]!.id).toBe('sg-web');
    expect(d.totals.added).toBe(1);
  });

  it('detects a removed SmartGroup', () => {
    const before = blank();
    before.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    const after = blank();
    const d = diffTopologies(before, after);
    expect(d.smartGroups.removed).toHaveLength(1);
    expect(d.smartGroups.removed[0]!.id).toBe('sg-web');
    expect(d.totals.removed).toBe(1);
  });

  it('detects a modified SmartGroup with per-field changes', () => {
    const before = blank();
    before.smartGroups.push({ id: 'sg-web', name: 'Web', color: '#3b82f6', criteria: [], matchType: 'any' });
    const after = blank();
    after.smartGroups.push({
      id: 'sg-web',
      name: 'Web Tier',
      color: '#3b82f6',
      criteria: [{ type: 'subnet', cidr: '10.0.0.0/24' }],
      matchType: 'any',
    });
    const d = diffTopologies(before, after);
    expect(d.smartGroups.modified).toHaveLength(1);
    const m = d.smartGroups.modified[0]!;
    expect(m.entity.id).toBe('sg-web');
    expect(m.changes!.name).toEqual({ from: 'Web', to: 'Web Tier' });
    expect(m.changes!.criteria).toBeDefined();
    expect(d.totals.modified).toBe(1);
  });

  it('treats objects whose only difference is key order as equal', () => {
    const before: DcfPolicyModel = blank();
    before.policies.push({
      id: 'pol-1',
      name: 'A',
      priority: 100,
      srcGroupId: 'sg-any',
      dstGroupId: 'sg-any',
      action: 'allow',
      protocol: 'tcp',
      logging: true,
    });
    // Same object but keys reordered (simulates JSON round-trip).
    const after = blank();
    after.policies.push({
      action: 'allow',
      protocol: 'tcp',
      logging: true,
      id: 'pol-1',
      dstGroupId: 'sg-any',
      srcGroupId: 'sg-any',
      priority: 100,
      name: 'A',
    });
    expect(diffTopologies(before, after).isEmpty).toBe(true);
  });

  it('detects a Policy whose priority changed', () => {
    const base = blank();
    const p = {
      id: 'pol-1',
      name: 'A',
      priority: 100,
      srcGroupId: 'sg-any',
      dstGroupId: 'sg-any',
      action: 'allow' as const,
      protocol: 'tcp' as const,
      logging: true,
    };
    const before = { ...base, policies: [p] };
    const after = { ...base, policies: [{ ...p, priority: 200 }] };
    const d = diffTopologies(before, after);
    expect(d.policies.modified).toHaveLength(1);
    expect(d.policies.modified[0]!.changes!.priority).toEqual({ from: 100, to: 200 });
  });

  it('detects added + removed + modified in the same call (totals roll up)', () => {
    const base = blank();
    const p1 = {
      id: 'pol-1', name: 'A', priority: 100, srcGroupId: 'sg-any', dstGroupId: 'sg-any',
      action: 'allow' as const, protocol: 'tcp' as const, logging: true,
    };
    const p2 = { ...p1, id: 'pol-2', name: 'B' };
    const p3 = { ...p1, id: 'pol-3', name: 'C' };
    const before = { ...base, policies: [p1, p2] };
    const after = { ...base, policies: [{ ...p1, priority: 50 }, p3] };
    const d = diffTopologies(before, after);
    expect(d.policies.added.map((p) => p.id)).toEqual(['pol-3']);
    expect(d.policies.removed.map((p) => p.id)).toEqual(['pol-2']);
    expect(d.policies.modified.map((m) => m.entity.id)).toEqual(['pol-1']);
    expect(d.totals).toEqual({ added: 1, removed: 1, modified: 1 });
    expect(d.isEmpty).toBe(false);
  });

  it('detects a WebGroup fqdn change', () => {
    const before = blank();
    before.webGroups.push({ id: 'wg-1', name: 'SaaS', fqdns: ['*.salesforce.com'] });
    const after = blank();
    after.webGroups.push({ id: 'wg-1', name: 'SaaS', fqdns: ['*.salesforce.com', '*.slack.com'] });
    const d = diffTopologies(before, after);
    expect(d.webGroups.modified).toHaveLength(1);
    expect(d.webGroups.modified[0]!.changes!.fqdns).toBeDefined();
  });
});
