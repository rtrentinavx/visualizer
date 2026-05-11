import { describe, it, expect } from 'vitest';
import type { DcfPolicyModel } from '../types/dcf';
import { applyPolicyTemplate } from './applyPolicyTemplate';
import { POLICY_TEMPLATES, type PolicyTemplate } from '../data/policyTemplates';

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

function findTemplate(id: string): PolicyTemplate {
  const t = POLICY_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`fixture missing: ${id}`);
  return t;
}

describe('applyPolicyTemplate', () => {
  it('Zero Trust Default Deny adds 1 deny-all policy and no groups', () => {
    const t = emptyTopology();
    const result = applyPolicyTemplate(t, findTemplate('tpl-zero-trust-deny'));
    expect(result.added.policies).toHaveLength(1);
    expect(result.added.smartGroups).toHaveLength(0);
    expect(result.added.policies[0]!.action).toBe('deny');
    expect(result.added.policies[0]!.srcGroupId).toBe('sg-any');
    expect(result.added.policies[0]!.dstGroupId).toBe('sg-any');
    expect(result.added.policies[0]!.priority).toBe(9999);
    expect(result.topology.policies).toHaveLength(1);
  });

  it('Bastion Access creates 2 SmartGroups and 2 policies', () => {
    const t = emptyTopology();
    const result = applyPolicyTemplate(t, findTemplate('tpl-bastion'));
    expect(result.added.smartGroups.map((g) => g.name).sort()).toEqual(['Bastion Hosts', 'Internal Servers']);
    expect(result.added.policies).toHaveLength(2);
    const ports = result.added.policies.map((p) => p.ports).sort();
    expect(ports).toEqual(['22', '3389']);
  });

  it('reuses existing SmartGroup when name matches (does not duplicate)', () => {
    const t = emptyTopology();
    t.smartGroups.push({
      id: 'sg-existing-bastion',
      name: 'Bastion Hosts',
      color: '#000000',
      criteria: [],
      matchType: 'any',
    });
    const result = applyPolicyTemplate(t, findTemplate('tpl-bastion'));
    expect(result.added.smartGroups.map((g) => g.name)).toEqual(['Internal Servers']);
    expect(result.reused.smartGroupNames).toContain('Bastion Hosts');
    // Policies should reference the *existing* Bastion group id, not a new one.
    const bastionPolicies = result.added.policies.filter((p) => p.srcGroupId === 'sg-existing-bastion');
    expect(bastionPolicies).toHaveLength(2);
  });

  it('skips an exact-duplicate policy on repeat apply', () => {
    const t = emptyTopology();
    const first = applyPolicyTemplate(t, findTemplate('tpl-bastion'));
    expect(first.skipped.duplicatePolicies).toHaveLength(0);

    const second = applyPolicyTemplate(first.topology, findTemplate('tpl-bastion'));
    expect(second.added.policies).toHaveLength(0);
    expect(second.skipped.duplicatePolicies.sort()).toEqual(['Bastion RDP to Internal', 'Bastion SSH to Internal']);
    expect(second.reused.smartGroupNames.sort()).toEqual(['Bastion Hosts', 'Internal Servers']);
  });

  it('bumps priority when a template priority collides with an existing one', () => {
    const t = emptyTopology();
    t.smartGroups.push({ id: 'sg-x', name: 'X', color: '#000', criteria: [], matchType: 'any' });
    t.policies.push({
      id: 'pol-existing-200',
      name: 'Existing',
      priority: 200,
      srcGroupId: 'sg-x',
      dstGroupId: 'sg-x',
      action: 'allow',
      protocol: 'tcp',
      logging: true,
    });
    const result = applyPolicyTemplate(t, findTemplate('tpl-bastion'));
    const newPriorities = result.added.policies.map((p) => p.priority).sort();
    // Template wanted 200 + 210; 200 is taken so it bumps. 210 should be fine.
    expect(newPriorities).toEqual([201, 210]);
  });

  it('Internet Egress with ThreatBlock attaches threat + geo refs onto the policy', () => {
    const t = emptyTopology();
    const result = applyPolicyTemplate(t, findTemplate('tpl-internet-egress-threatblock'));
    expect(result.added.threatGroups).toHaveLength(1);
    expect(result.added.geoGroups).toHaveLength(1);
    expect(result.added.policies).toHaveLength(1);
    const p = result.added.policies[0]!;
    expect(p.threatGroup).toBe(result.added.threatGroups[0]!.id);
    expect(p.geoGroup).toBe(result.added.geoGroups[0]!.id);
  });

  it('Three-Tier Web Application adds 3 groups + 3 policies (incl. one deny)', () => {
    const t = emptyTopology();
    const result = applyPolicyTemplate(t, findTemplate('tpl-three-tier-web'));
    expect(result.added.smartGroups.map((g) => g.name).sort()).toEqual(['App Tier', 'Database Tier', 'Web Tier']);
    expect(result.added.policies).toHaveLength(3);
    const denyCount = result.added.policies.filter((p) => p.action === 'deny').length;
    expect(denyCount).toBe(1);
  });

  it('does not mutate the input topology', () => {
    const t = emptyTopology();
    const snapshotPolicies = t.policies.length;
    const snapshotGroups = t.smartGroups.length;
    applyPolicyTemplate(t, findTemplate('tpl-bastion'));
    expect(t.policies.length).toBe(snapshotPolicies);
    expect(t.smartGroups.length).toBe(snapshotGroups);
  });
});
