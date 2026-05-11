import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { resolveSearchFilter, searchPolicies } from './policySearch';

function topology(policies: DcfPolicy[] = []): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
      { id: 'sg-web', name: 'Web Tier', color: '#3b82f6', criteria: [], matchType: 'any' },
      { id: 'sg-db', name: 'Database Tier', color: '#f59e0b', criteria: [], matchType: 'any' },
    ],
    webGroups: [{ id: 'wg-saas', name: 'SaaS Essentials', fqdns: ['*.salesforce.com'] }],
    threatGroups: [{ id: 'tg-malware', name: 'Malware', category: 'malware', entryCount: 1 }],
    geoGroups: [{ id: 'gg-cn', name: 'China', countries: ['CN'] }],
    policies,
    flows: [],
  };
}

function p(overrides: Partial<DcfPolicy> & { id: string }): DcfPolicy {
  return {
    name: overrides.id, priority: 100, srcGroupId: 'sg-any', dstGroupId: 'sg-any',
    action: 'allow', protocol: 'tcp', logging: true,
    ...overrides,
  };
}

describe('resolveSearchFilter', () => {
  it('resolves SmartGroup names case-insensitively', () => {
    const t = topology();
    const r = resolveSearchFilter(t, { canAnswer: true, srcGroupName: 'WEB tier', dstGroupName: 'database TIER' });
    expect(r.srcGroupId).toBe('sg-web');
    expect(r.dstGroupId).toBe('sg-db');
    expect(r.unresolvedNames).toEqual([]);
  });

  it('reports unresolved names but still returns a partial filter', () => {
    const t = topology();
    const r = resolveSearchFilter(t, { canAnswer: true, srcGroupName: 'Ghost Tier', actions: ['allow'] });
    expect(r.srcGroupId).toBeUndefined();
    expect(r.unresolvedNames.some((n) => n.includes('Ghost Tier'))).toBe(true);
    expect(r.actions).toEqual(['allow']);
  });

  it('"Internet" resolves to sg-internet for the destination', () => {
    const t = topology();
    const r = resolveSearchFilter(t, { canAnswer: true, dstGroupName: 'internet' });
    expect(r.dstGroupId).toBe('sg-internet');
  });
});

describe('searchPolicies', () => {
  it('filters by src + dst group ids', () => {
    const t = topology([
      p({ id: 'a', srcGroupId: 'sg-web', dstGroupId: 'sg-db', action: 'allow' }),
      p({ id: 'b', srcGroupId: 'sg-web', dstGroupId: 'sg-internet', action: 'allow' }),
      p({ id: 'c', srcGroupId: 'sg-any', dstGroupId: 'sg-db', action: 'deny' }),
    ]);
    const r = resolveSearchFilter(t, { canAnswer: true, srcGroupName: 'Web Tier', dstGroupName: 'Database Tier' });
    expect(searchPolicies(t, r).map((x) => x.id)).toEqual(['a']);
  });

  it('filters by action subset', () => {
    const t = topology([
      p({ id: 'a', action: 'allow' }),
      p({ id: 'b', action: 'deny' }),
      p({ id: 'c', action: 'learned' }),
    ]);
    const r = resolveSearchFilter(t, { canAnswer: true, actions: ['allow', 'learned'] });
    expect(searchPolicies(t, r).map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  it('filters by protocol', () => {
    const t = topology([
      p({ id: 'a', protocol: 'tcp' }),
      p({ id: 'b', protocol: 'udp' }),
      p({ id: 'c', protocol: 'any' }),
    ]);
    const r = resolveSearchFilter(t, { canAnswer: true, protocols: ['udp'] });
    expect(searchPolicies(t, r).map((x) => x.id)).toEqual(['b']);
  });

  it('filters by containsPort against the comma-separated port list', () => {
    const t = topology([
      p({ id: 'a', ports: '443' }),
      p({ id: 'b', ports: '8080,8443' }),
      p({ id: 'c', ports: '22' }),
    ]);
    const r = resolveSearchFilter(t, { canAnswer: true, containsPort: '8443' });
    expect(searchPolicies(t, r).map((x) => x.id)).toEqual(['b']);
  });

  it('filters by hasThreatGroup / hasGeoGroup / hasWebGroup booleans', () => {
    const t = topology([
      p({ id: 'a' }),
      p({ id: 'b', threatGroup: 'tg-malware' }),
      p({ id: 'c', geoGroup: 'gg-cn' }),
      p({ id: 'd', webGroupIds: ['wg-saas'] }),
    ]);
    expect(searchPolicies(t, resolveSearchFilter(t, { canAnswer: true, hasThreatGroup: true })).map((x) => x.id)).toEqual(['b']);
    expect(searchPolicies(t, resolveSearchFilter(t, { canAnswer: true, hasGeoGroup: true })).map((x) => x.id)).toEqual(['c']);
    expect(searchPolicies(t, resolveSearchFilter(t, { canAnswer: true, hasWebGroup: true })).map((x) => x.id)).toEqual(['d']);
  });

  it('filters decryptOnly and loggingDisabled', () => {
    const t = topology([
      p({ id: 'a', decrypt: true }),
      p({ id: 'b', decrypt: false }),
      p({ id: 'c', logging: false }),
      p({ id: 'd', logging: true }),
    ]);
    expect(searchPolicies(t, resolveSearchFilter(t, { canAnswer: true, decryptOnly: true })).map((x) => x.id)).toEqual(['a']);
    expect(searchPolicies(t, resolveSearchFilter(t, { canAnswer: true, loggingDisabled: true })).map((x) => x.id)).toEqual(['c']);
  });

  it('combines filters with AND semantics', () => {
    const t = topology([
      p({ id: 'a', srcGroupId: 'sg-web', dstGroupId: 'sg-db', action: 'allow', protocol: 'tcp', ports: '443' }),
      p({ id: 'b', srcGroupId: 'sg-web', dstGroupId: 'sg-db', action: 'deny', protocol: 'tcp', ports: '443' }),
      p({ id: 'c', srcGroupId: 'sg-web', dstGroupId: 'sg-db', action: 'allow', protocol: 'tcp', ports: '8080' }),
    ]);
    const filter = resolveSearchFilter(t, {
      canAnswer: true,
      srcGroupName: 'Web Tier',
      dstGroupName: 'Database Tier',
      actions: ['allow'],
      containsPort: '443',
    });
    expect(searchPolicies(t, filter).map((x) => x.id)).toEqual(['a']);
  });

  it('an empty filter returns every policy', () => {
    const t = topology([p({ id: 'a' }), p({ id: 'b' })]);
    const r = resolveSearchFilter(t, { canAnswer: true });
    expect(searchPolicies(t, r)).toHaveLength(2);
  });
});
