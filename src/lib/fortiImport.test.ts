import { describe, it, expect } from 'vitest';
import { importFortiPolicy, buildDcfModel } from './fortiImport';

// ─── .conf format ─────────────────────────────────────────────────────────────

describe('importFortiPolicy — .conf', () => {
  const BASIC_CONF = `
config firewall address
    edit "CORP-NET"
        set type ipmask
        set subnet 10.0.0.0 255.255.0.0
    next
    edit "DMZ"
        set type ipmask
        set subnet 192.168.10.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set name "allow-corp-to-dmz"
        set srcaddr "CORP-NET"
        set dstaddr "DMZ"
        set service "HTTP"
        set action accept
        set logtraffic all
    next
end
`;

  it('creates SmartGroups for each address object', () => {
    const { topology } = importFortiPolicy(BASIC_CONF);
    const names = topology.smartGroups.map((g) => g.name);
    expect(names).toContain('CORP-NET');
    expect(names).toContain('DMZ');
  });

  it('maps CIDR criteria from ipmask address', () => {
    const { topology } = importFortiPolicy(BASIC_CONF);
    const corp = topology.smartGroups.find((g) => g.name === 'CORP-NET')!;
    expect(corp.criteria).toEqual([{ type: 'subnet', cidr: '10.0.0.0/16' }]);
  });

  it('maps well-known service HTTP to tcp:80', () => {
    const { topology } = importFortiPolicy(BASIC_CONF);
    expect(topology.policies[0]!.protocol).toBe('tcp');
    expect(topology.policies[0]!.ports).toBe('80');
  });

  it('sets action and logging from .conf fields', () => {
    const { topology } = importFortiPolicy(BASIC_CONF);
    expect(topology.policies[0]!.action).toBe('allow');
    expect(topology.policies[0]!.logging).toBe(true);
  });

  it('deny action maps correctly', () => {
    const conf = `
config firewall policy
    edit 1
        set name "block-all"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies[0]!.action).toBe('deny');
  });

  it('resolves addrgrp members into a single SmartGroup with merged criteria', () => {
    const conf = `
config firewall address
    edit "NET-A"
        set type ipmask
        set subnet 10.1.0.0 255.255.0.0
    next
    edit "NET-B"
        set type ipmask
        set subnet 10.2.0.0 255.255.0.0
    next
end
config firewall addrgrp
    edit "ALL-INTERNAL"
        set member "NET-A" "NET-B"
    next
end
config firewall policy
    edit 1
        set name "allow-internal"
        set srcaddr "ALL-INTERNAL"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    const sg = topology.smartGroups.find((g) => g.name === 'ALL-INTERNAL')!;
    expect(sg).toBeDefined();
    expect(sg.criteria).toHaveLength(2);
    expect(sg.criteria.map((c) => c.cidr)).toEqual(
      expect.arrayContaining(['10.1.0.0/16', '10.2.0.0/16']),
    );
  });

  it('maps "all" destination to sg-any', () => {
    const conf = `
config firewall policy
    edit 1
        set name "allow-all-out"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies[0]!.srcGroupId).toStrictEqual(['sg-any']);
    expect(topology.policies[0]!.dstGroupId).toStrictEqual(['sg-any']);
  });

  it('always seeds sg-any and sg-internet', () => {
    const { topology } = importFortiPolicy(BASIC_CONF);
    expect(topology.smartGroups.find((g) => g.id === 'sg-any')).toBeDefined();
    expect(topology.smartGroups.find((g) => g.id === 'sg-internet')).toBeDefined();
  });

  it('records FQDN addresses in warnings and skips their criteria', () => {
    const conf = `
config firewall address
    edit "GITHUB"
        set type fqdn
        set fqdn "github.com"
    next
end
config firewall policy
    edit 1
        set name "allow-github"
        set srcaddr "all"
        set dstaddr "GITHUB"
        set service "HTTPS"
        set action accept
    next
end
`;
    const { topology, warnings } = importFortiPolicy(conf);
    const sg = topology.smartGroups.find((g) => g.name === 'GITHUB');
    expect(sg?.criteria).toHaveLength(0);
    expect(warnings.some((w) => w.includes('FQDN'))).toBe(true);
  });

  it('fans out one FortiGate policy with multiple services into N DCF policies', () => {
    const conf = `
config firewall address
    edit "SRC"
        set type ipmask
        set subnet 10.0.0.0 255.255.0.0
    next
end
config firewall policy
    edit 1
        set name "multi-svc"
        set srcaddr "SRC"
        set dstaddr "all"
        set service "HTTP" "HTTPS" "DNS"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies).toHaveLength(3);
    const protocols = topology.policies.map((p) => p.protocol);
    expect(protocols).toContain('tcp');
    expect(protocols).toContain('udp');
  });

  it('resolves custom service port ranges', () => {
    const conf = `
config firewall service custom
    edit "MY-APP"
        set protocol TCP
        set tcp-portrange 8080-8090
    next
end
config firewall policy
    edit 1
        set name "allow-app"
        set srcaddr "all"
        set dstaddr "all"
        set service "MY-APP"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies[0]!.protocol).toBe('tcp');
    expect(topology.policies[0]!.ports).toBe('8080-8090');
  });

  it('resolves service groups recursively', () => {
    const conf = `
config firewall service group
    edit "WEB-SVCS"
        set member "HTTP" "HTTPS"
    next
end
config firewall policy
    edit 1
        set name "allow-web"
        set srcaddr "all"
        set dstaddr "all"
        set service "WEB-SVCS"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies).toHaveLength(2);
  });

  it('assigns ascending priorities across policies', () => {
    const conf = `
config firewall policy
    edit 1
        set name "first"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
    edit 2
        set name "second"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action deny
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    expect(topology.policies[0]!.priority).toBeLessThan(topology.policies[1]!.priority);
  });

  it('parses dotted-decimal subnet mask correctly', () => {
    const conf = `
config firewall address
    edit "RFC1918-A"
        set type ipmask
        set subnet 10.0.0.0 255.0.0.0
    next
    edit "RFC1918-B"
        set type ipmask
        set subnet 172.16.0.0 255.240.0.0
    next
    edit "RFC1918-C"
        set type ipmask
        set subnet 192.168.0.0 255.255.0.0
    next
end
config firewall policy
    edit 1
        set name "p-a"
        set srcaddr "RFC1918-A"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
    edit 2
        set name "p-b"
        set srcaddr "RFC1918-B"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
    edit 3
        set name "p-c"
        set srcaddr "RFC1918-C"
        set dstaddr "all"
        set service "ALL"
        set action accept
    next
end
`;
    const { topology } = importFortiPolicy(conf);
    const cidrs = topology.smartGroups.flatMap((g) => g.criteria.map((c) => c.cidr)).filter(Boolean);
    expect(cidrs).toContain('10.0.0.0/8');
    expect(cidrs).toContain('172.16.0.0/12');
    expect(cidrs).toContain('192.168.0.0/16');
  });
});

// ─── XML format ───────────────────────────────────────────────────────────────

describe('importFortiPolicy — XML (FortiManager format)', () => {
  const BASIC_XML = `<?xml version="1.0" encoding="utf-8"?>
<FortiGate_Config>
  <table name="firewall address">
    <entry name="CORP-NET">
      <type>ipmask</type>
      <subnet>10.0.0.0 255.255.0.0</subnet>
    </entry>
    <entry name="DMZ">
      <type>ipmask</type>
      <subnet>192.168.10.0 255.255.255.0</subnet>
    </entry>
  </table>
  <table name="firewall addrgrp">
    <entry name="ALL-RFC1918">
      <member>
        <list>CORP-NET</list>
        <list>DMZ</list>
      </member>
    </entry>
  </table>
  <table name="firewall service custom">
    <entry name="MY-APP">
      <protocol>TCP</protocol>
      <tcp-portrange>8443</tcp-portrange>
    </entry>
  </table>
  <table name="firewall policy">
    <entry id="1">
      <name>allow-corp-web</name>
      <srcaddr>
        <list>CORP-NET</list>
      </srcaddr>
      <dstaddr>
        <list>all</list>
      </dstaddr>
      <service>
        <list>HTTP</list>
        <list>HTTPS</list>
      </service>
      <action>accept</action>
      <logtraffic>all</logtraffic>
    </entry>
    <entry id="2">
      <name>allow-grp-app</name>
      <srcaddr>
        <list>ALL-RFC1918</list>
      </srcaddr>
      <dstaddr>
        <list>all</list>
      </dstaddr>
      <service>
        <list>MY-APP</list>
      </service>
      <action>accept</action>
    </entry>
  </table>
</FortiGate_Config>`;

  it('detects XML format and parses SmartGroups', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    const names = topology.smartGroups.map((g) => g.name);
    // CORP-NET is referenced directly by policy 1; ALL-RFC1918 is the addrgrp
    // (DMZ is flattened into ALL-RFC1918's criteria, not a standalone group)
    expect(names).toContain('CORP-NET');
    expect(names).toContain('ALL-RFC1918');
  });

  it('resolves addrgrp member list in XML format', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    const grp = topology.smartGroups.find((g) => g.name === 'ALL-RFC1918')!;
    expect(grp).toBeDefined();
    expect(grp.criteria).toHaveLength(2);
  });

  it('fans out multi-service XML policy into N DCF policies', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    // Policy 1: HTTP + HTTPS = 2 DCF policies
    const webPolicies = topology.policies.filter((p) => p.name.startsWith('allow-corp-web'));
    expect(webPolicies).toHaveLength(2);
  });

  it('maps custom XML service port range', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    const appPol = topology.policies.find((p) => p.name === 'allow-grp-app')!;
    expect(appPol.protocol).toBe('tcp');
    expect(appPol.ports).toBe('8443');
  });

  it('maps "all" dstaddr to sg-any in XML', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    const pol = topology.policies.find((p) => p.name.includes('allow-corp-web'))!;
    expect(pol.dstGroupId).toStrictEqual(['sg-any']);
  });

  it('seeds sg-any and sg-internet regardless of XML content', () => {
    const { topology } = importFortiPolicy(BASIC_XML);
    expect(topology.smartGroups.find((g) => g.id === 'sg-any')).toBeDefined();
    expect(topology.smartGroups.find((g) => g.id === 'sg-internet')).toBeDefined();
  });

  it('records FQDN warnings from XML addresses', () => {
    const xml = `<root>
  <table name="firewall address">
    <entry name="GITHUB"><type>fqdn</type><fqdn>github.com</fqdn></entry>
  </table>
  <table name="firewall policy">
    <entry id="1">
      <name>p1</name>
      <srcaddr><list>all</list></srcaddr>
      <dstaddr><list>GITHUB</list></dstaddr>
      <service><list>HTTPS</list></service>
      <action>accept</action>
    </entry>
  </table>
</root>`;
    const { warnings } = importFortiPolicy(xml);
    expect(warnings.some((w) => w.includes('FQDN'))).toBe(true);
  });
});

// ─── buildDcfModel unit tests ─────────────────────────────────────────────────

describe('buildDcfModel', () => {
  it('deduplicates SmartGroups when multiple policies share same src', () => {
    const addresses = new Map([['NET-A', { name: 'NET-A', type: 'ipmask' as const, cidr: '10.0.0.0/8' }]]);
    const policies = [
      { id: '1', name: 'p1', srcAddrs: ['NET-A'], dstAddrs: ['all'], services: [], action: 'allow' as const, logging: false },
      { id: '2', name: 'p2', srcAddrs: ['NET-A'], dstAddrs: ['all'], services: [], action: 'deny' as const, logging: false },
    ];
    const { topology } = buildDcfModel(addresses, new Map(), new Map(), new Map(), policies);
    const netA = topology.smartGroups.filter((g) => g.name === 'NET-A');
    expect(netA).toHaveLength(1);
    expect(topology.policies[0]!.srcGroupId).toStrictEqual(topology.policies[1]!.srcGroupId);
  });

  it('produces geography warning and no criteria', () => {
    const addresses = new Map([['CN', { name: 'CN', type: 'geography' as const }]]);
    const policies = [
      { id: '1', name: 'p', srcAddrs: ['CN'], dstAddrs: ['all'], services: [], action: 'deny' as const, logging: false },
    ];
    const { warnings, topology } = buildDcfModel(addresses, new Map(), new Map(), new Map(), policies);
    expect(warnings.some((w) => w.includes('Geography'))).toBe(true);
    const sg = topology.smartGroups.find((g) => g.name === 'CN')!;
    expect(sg.criteria).toHaveLength(0);
  });
});
