import { describe, it, expect } from 'vitest';
import { mapTopology } from './mapTopology';

describe('mapTopology', () => {
  it('maps a SmartGroup with mixed selector shapes (cidr + tags + vpc/name)', () => {
    const raw = {
      smartGroups: [
        {
          uuid: '8696a1f9-1a1f-4992-99bc-6904684bd1b4',
          name: 'Web Tier',
          selector: {
            match_expressions: [
              { cidr: '10.0.0.0/24' },
              { tags: { Env: 'prod', Tier: 'web' } },
              { type: 'vpc', name: 'kccd-euc' },
            ],
          },
        },
      ],
      webGroups: [],
      threatGroups: [],
      geoGroups: [],
      policies: [],
    };
    const { topology } = mapTopology(raw);
    const sg = topology.smartGroups.find((g) => g.id === '8696a1f9-1a1f-4992-99bc-6904684bd1b4')!;
    expect(sg.name).toBe('Web Tier');
    expect(sg.criteria).toContainEqual({ type: 'subnet', cidr: '10.0.0.0/24' });
    expect(sg.criteria).toContainEqual({ type: 'vm', key: 'Env', operator: 'equals', value: 'prod' });
    expect(sg.criteria).toContainEqual({ type: 'vm', key: 'Tier', operator: 'equals', value: 'web' });
    expect(sg.criteria).toContainEqual({ type: 'vm', key: 'vpc', operator: 'equals', value: 'kccd-euc' });
  });

  it('maps a WebGroup with snifilter + urlfilter into one fqdns array', () => {
    const raw = {
      smartGroups: [],
      webGroups: [
        {
          uuid: 'def000ad-0000-0000-0000-000000000002',
          name: 'EUC-Blacklist',
          selector: {
            match_expressions: [
              { snifilter: 'secure.mailjol.net' },
              { urlfilter: '*.tracker.example.com' },
            ],
          },
        },
      ],
      threatGroups: [],
      geoGroups: [],
      policies: [],
    };
    const { topology } = mapTopology(raw);
    expect(topology.webGroups).toHaveLength(1);
    expect(topology.webGroups[0]!.fqdns).toEqual(['secure.mailjol.net', '*.tracker.example.com']);
  });

  it('preserves server UUIDs on cross-references — policy.webGroupIds matches the WebGroup id', () => {
    const raw = {
      smartGroups: [
        { uuid: 'sg-src', name: 'Src', selector: { match_expressions: [{ cidr: '10.0.0.0/24' }] } },
        { uuid: 'sg-dst', name: 'Dst', selector: { match_expressions: [{ cidr: '10.0.1.0/24' }] } },
      ],
      webGroups: [
        { uuid: 'wg-sfdc', name: 'Salesforce', selector: { match_expressions: [{ snifilter: '*.salesforce.com' }] } },
      ],
      threatGroups: [],
      geoGroups: [],
      policies: [
        {
          uuid: 'pol-1',
          name: 'WebToSFDC',
          action: 'PERMIT',
          src_smart_groups: ['sg-src'],
          dst_smart_groups: ['sg-dst'],
          web_groups: ['wg-sfdc'],
          priority: 100,
          protocol: 'TCP',
          port_ranges: ['443'],
          logging: true,
        },
      ],
    };
    const { topology } = mapTopology(raw);
    const policy = topology.policies[0]!;
    expect(policy.srcGroupId).toBe('sg-src');
    expect(policy.dstGroupId).toBe('sg-dst');
    expect(policy.webGroupIds).toEqual(['wg-sfdc']);
    expect(policy.ports).toBe('443');
    expect(policy.action).toBe('allow');
  });

  it('always ensures sg-internet exists even when the server returns no SmartGroups', () => {
    const raw = { smartGroups: [], webGroups: [], threatGroups: [], geoGroups: [], policies: [] };
    const { topology } = mapTopology(raw);
    expect(topology.smartGroups.find((g) => g.id === 'sg-internet')).toBeDefined();
  });

  it('counts dropped entries when raw shape is unparseable', () => {
    const raw = {
      smartGroups: [null, 'not an object', 42, { name: 'OK' }],
      webGroups: [],
      threatGroups: [],
      geoGroups: [],
      policies: [],
    };
    const { topology, droppedCounts } = mapTopology(raw);
    expect(droppedCounts.smartGroups).toBe(3);
    // One valid entry + the auto-inserted sg-any + sg-internet pseudo-groups = 3.
    expect(topology.smartGroups).toHaveLength(3);
  });

  it('maps decrypt_policy=DECRYPT_REQUIRED to decrypt=true', () => {
    const raw = {
      smartGroups: [], webGroups: [], threatGroups: [], geoGroups: [],
      policies: [{ name: 'x', action: 'PERMIT', decrypt_policy: 'DECRYPT_REQUIRED' }],
    };
    const { topology } = mapTopology(raw);
    expect(topology.policies[0]!.decrypt).toBe(true);
  });

  // -------------------------------------------------------------------------
  // v2.5 REST API shapes (selector.any[].all format — confirmed from live 8.2 controller)
  // -------------------------------------------------------------------------

  it('v2.5: maps SmartGroup selector.any[].all with cidr + vpc/name criteria', () => {
    const raw = {
      smartGroups: [{
        uuid: 'sg-vpc-1',
        name: 'naas-shared-cluster',
        selector: { any: [
          { all: { type: 'vpc', name: 'naas-shared-vnet' } },
          { all: { cidr: '10.1.0.0/16' } },
        ]},
      }],
      webGroups: [], threatGroups: [], geoGroups: [], policies: [],
    };
    const { topology } = mapTopology(raw);
    const sg = topology.smartGroups.find(g => g.id === 'sg-vpc-1')!;
    expect(sg.name).toBe('naas-shared-cluster');
    expect(sg.criteria).toContainEqual({ type: 'vm', key: 'vpc', operator: 'equals', value: 'naas-shared-vnet' });
    expect(sg.criteria).toContainEqual({ type: 'subnet', cidr: '10.1.0.0/16' });
  });

  it('v2.5: maps WebGroup selector.any[].all.snifilter', () => {
    const raw = {
      smartGroups: [],
      webGroups: [{
        uuid: 'wg-azure-egress',
        name: 'azure-egress',
        selector: { any: [
          { all: { snifilter: '*.blob.core.windows.net' } },
          { all: { snifilter: 'pypi.org' } },
        ]},
      }],
      threatGroups: [], geoGroups: [], policies: [],
    };
    const { topology } = mapTopology(raw);
    expect(topology.webGroups[0]!.fqdns).toEqual(['*.blob.core.windows.net', 'pypi.org']);
  });

  it('v2.5: maps GeoGroup selector.any[].all.country_iso_code', () => {
    const raw = {
      smartGroups: [], webGroups: [], threatGroups: [],
      geoGroups: [{
        uuid: 'gg-blocked',
        name: 'patternc-sg-geo-blocked',
        selector: { any: [
          { all: { country_iso_code: 'IR', external: 'geo' } },
          { all: { country_iso_code: 'KP', external: 'geo' } },
          { all: { country_iso_code: 'RU', external: 'geo' } },
        ]},
      }],
      policies: [],
    };
    const { topology } = mapTopology(raw);
    expect(topology.geoGroups[0]!.countries).toEqual(['IR', 'KP', 'RU']);
  });

  it('v2.5: maps ThreatGroup selector.any[].all.external to category', () => {
    const raw = {
      smartGroups: [], webGroups: [],
      threatGroups: [{
        uuid: 'tg-threat-intel',
        name: 'patternc-sg-threat-intel',
        selector: { any: [
          { all: { external: 'threatiq', severity: 'major' } },
          { all: { external: 'threatiq', severity: 'critical' } },
        ]},
      }],
      geoGroups: [], policies: [],
    };
    const { topology } = mapTopology(raw);
    expect(topology.threatGroups[0]!.category).toBe('malware');
  });

  it('v2.5: maps policy src_ads/dst_ads, port_ranges [{lo,hi}], and decrypt_policy=DECRYPT_ALLOWED', () => {
    const raw = {
      smartGroups: [
        { uuid: 'sg-src', name: 'Src', selector: { any: [{ all: { cidr: '10.0.0.0/24' } }] } },
        { uuid: 'sg-dst', name: 'Dst', selector: { any: [{ all: { cidr: '10.0.1.0/24' } }] } },
      ],
      webGroups: [
        { uuid: 'wg-sfdc', name: 'Salesforce', selector: { any: [{ all: { snifilter: '*.salesforce.com' } }] } },
      ],
      threatGroups: [], geoGroups: [],
      policies: [{
        uuid: 'pol-1',
        name: 'allow-https',
        action: 'PERMIT',
        priority: 10,
        protocol: 'TCP',
        src_ads: ['sg-src'],
        dst_ads: ['sg-dst'],
        web_filters: ['wg-sfdc'],
        port_ranges: [{ lo: 443, hi: 443 }, { lo: 8080, hi: 8090 }],
        decrypt_policy: 'DECRYPT_ALLOWED',
        logging: true,
      }],
    };
    const { topology } = mapTopology(raw);
    const policy = topology.policies[0]!;
    expect(policy.srcGroupId).toBe('sg-src');
    expect(policy.dstGroupId).toBe('sg-dst');
    expect(policy.webGroupIds).toEqual(['wg-sfdc']);
    expect(policy.ports).toBe('443,8080-8090');
    expect(policy.action).toBe('allow');
    expect(policy.decrypt).toBe(true);
  });

  it('v2.5: remaps controller wildcard UUID (def000ad-...) to sg-any', () => {
    const ANY_UUID = 'def000ad-0000-0000-0000-000000000000';
    const INTERNET_UUID = 'def000ad-0000-0000-0000-000000000001';
    const raw = {
      smartGroups: [
        { uuid: ANY_UUID, name: 'avtx_system_v4_wildcard_app_domain',
          selector: { any: [{ all: { cidr: '0.0.0.0/0' } }] } },
        { uuid: INTERNET_UUID, name: 'avtx_system_internet_routes_app_domain',
          selector: { any: [{ all: { cidr: '0.0.0.0/5' } }] } },
      ],
      webGroups: [], threatGroups: [], geoGroups: [],
      policies: [{
        uuid: 'pol-1', name: 'deny-all', action: 'DENY', priority: 999,
        protocol: 'PROTOCOL_UNSPECIFIED',
        src_ads: [ANY_UUID],
        dst_ads: [INTERNET_UUID],
        web_filters: [], port_ranges: [], logging: false,
      }],
    };
    const { topology } = mapTopology(raw);
    expect(topology.smartGroups.find(g => g.id === 'sg-any')).toBeDefined();
    expect(topology.smartGroups.find(g => g.id === 'sg-internet')).toBeDefined();
    expect(topology.policies[0]!.srcGroupId).toBe('sg-any');
    expect(topology.policies[0]!.dstGroupId).toBe('sg-internet');
    expect(topology.policies[0]!.protocol).toBe('any');
  });
});
