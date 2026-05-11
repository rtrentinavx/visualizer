import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { resolveIntent, checkReachability } from './reachability';

function baseTopology(): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
      { id: 'sg-web', name: 'Web Tier', color: '#3b82f6', criteria: [], matchType: 'any' },
      { id: 'sg-app', name: 'App Tier', color: '#10b981', criteria: [], matchType: 'any' },
    ],
    webGroups: [
      { id: 'wg-saas', name: 'SaaS Essentials', fqdns: ['*.salesforce.com', '*.office.com'] },
    ],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

describe('resolveIntent', () => {
  it('case-insensitive SmartGroup name matching', () => {
    const t = baseTopology();
    const r = resolveIntent(t, { srcGroupName: 'web tier', dstGroupName: 'app TIER', protocol: 'tcp', port: 8443 });
    expect('reason' in r).toBe(false);
    if ('reason' in r) return;
    expect(r.srcGroup.id).toBe('sg-web');
    expect(r.dstGroup?.id).toBe('sg-app');
  });

  it('returns an error with unresolved names when a group is unknown', () => {
    const t = baseTopology();
    const r = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'Database Tier' });
    expect('reason' in r).toBe(true);
    if (!('reason' in r)) return;
    expect(r.unresolvedNames.some((n) => n.includes('Database Tier'))).toBe(true);
  });

  it('"Any" source resolves to sg-any', () => {
    const t = baseTopology();
    const r = resolveIntent(t, { srcGroupName: 'Any', dstGroupName: 'App Tier' });
    if ('reason' in r) throw new Error('unexpected error');
    expect(r.srcGroup.id).toBe('sg-any');
  });

  it('WebGroup destination forces isInternet=true and skips SmartGroup', () => {
    const t = baseTopology();
    const r = resolveIntent(t, { srcGroupName: 'Web Tier', dstWebGroupName: 'SaaS Essentials' });
    if ('reason' in r) throw new Error('unexpected error');
    expect(r.dstWebGroup?.id).toBe('wg-saas');
    expect(r.isInternet).toBe(true);
    expect(r.dstGroup).toBeUndefined();
  });

  it('"Internet" SmartGroup name resolves to sg-internet', () => {
    const t = baseTopology();
    const r = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'Internet' });
    if ('reason' in r) throw new Error('unexpected error');
    expect(r.dstGroup?.id).toBe('sg-internet');
  });
});

describe('checkReachability', () => {
  function policy(o: Partial<DcfPolicy> & { id: string }): DcfPolicy {
    return {
      name: o.id,
      priority: 100,
      srcGroupId: 'sg-any',
      dstGroupId: 'sg-any',
      action: 'allow',
      protocol: 'tcp',
      logging: false,
      ...o,
    };
  }

  it('implicit-deny when no policy matches', () => {
    const t = baseTopology();
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'App Tier', protocol: 'tcp', port: 8443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('implicit-deny');
    expect(v.matchedPolicy).toBeNull();
  });

  it('returns the winning policy for a matching allow', () => {
    const t = baseTopology();
    t.policies.push(policy({ id: 'allow-web-app', srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443' }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'App Tier', protocol: 'tcp', port: 8443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('allow');
    expect(v.matchedPolicy?.id).toBe('allow-web-app');
  });

  it('priority order — lower number wins even when higher-number policy matches', () => {
    const t = baseTopology();
    t.policies.push(policy({ id: 'deny-broad', priority: 100, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'deny', protocol: 'any' }));
    t.policies.push(policy({ id: 'allow-narrow', priority: 200, srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443' }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'App Tier', protocol: 'tcp', port: 8443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.matchedPolicy?.id).toBe('deny-broad');
    expect(v.consideredPolicies).toHaveLength(2);
  });

  it('WebGroup destination — policy with matching WebGroup attached wins', () => {
    const t = baseTopology();
    t.policies.push(policy({
      id: 'allow-saas',
      srcGroupId: 'sg-web',
      dstGroupId: 'sg-internet',
      action: 'allow',
      protocol: 'tcp',
      ports: '443',
      webGroupIds: ['wg-saas'],
    }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstWebGroupName: 'SaaS Essentials', protocol: 'tcp', port: 443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('allow');
    expect(v.matchedPolicy?.id).toBe('allow-saas');
  });

  it('WebGroup destination — policy with WebGroup attached but different webgroup does NOT match', () => {
    const t = baseTopology();
    t.webGroups.push({ id: 'wg-dev', name: 'Dev Tools', fqdns: ['*.github.com'] });
    t.policies.push(policy({
      id: 'allow-dev',
      srcGroupId: 'sg-web',
      dstGroupId: 'sg-internet',
      action: 'allow',
      protocol: 'tcp',
      ports: '443',
      webGroupIds: ['wg-dev'],
    }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstWebGroupName: 'SaaS Essentials', protocol: 'tcp', port: 443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('implicit-deny');
  });

  it('WebGroup destination — broad internet allow (no webgroups attached) DOES match', () => {
    const t = baseTopology();
    t.policies.push(policy({
      id: 'allow-internet-broad',
      srcGroupId: 'sg-web',
      dstGroupId: 'sg-internet',
      action: 'allow',
      protocol: 'tcp',
      ports: '443',
    }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstWebGroupName: 'SaaS Essentials', protocol: 'tcp', port: 443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('allow');
    expect(v.matchedPolicy?.id).toBe('allow-internet-broad');
  });

  it('policies with enforcement=false are skipped', () => {
    const t = baseTopology();
    t.policies.push(policy({ id: 'off', srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443', enforcement: false }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'App Tier', protocol: 'tcp', port: 8443 });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('implicit-deny');
  });

  it('port=undefined excludes policies that require a specific port', () => {
    const t = baseTopology();
    t.policies.push(policy({ id: 'narrow', srcGroupId: 'sg-web', dstGroupId: 'sg-app', action: 'allow', protocol: 'tcp', ports: '8443' }));
    const intent = resolveIntent(t, { srcGroupName: 'Web Tier', dstGroupName: 'App Tier', protocol: 'tcp' });
    if ('reason' in intent) throw new Error('unexpected');
    const v = checkReachability(t, intent);
    expect(v.outcome).toBe('implicit-deny');
  });
});
