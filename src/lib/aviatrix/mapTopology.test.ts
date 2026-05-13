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
});
