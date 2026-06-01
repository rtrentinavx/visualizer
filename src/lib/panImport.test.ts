import { describe, it, expect } from 'vitest';
import { importPanPolicy } from './panImport';

// Minimal PAN XML helper — wraps content in a valid vsys config envelope
function vsysXml(inner: string): string {
  return `<?xml version="1.0"?>
<config version="10.1.0">
  <devices>
    <entry name="localhost.localdomain">
      <vsys>
        <entry name="vsys1">
          ${inner}
        </entry>
      </vsys>
    </entry>
  </devices>
</config>`;
}

const BASIC_XML = vsysXml(`
  <address>
    <entry name="CORP-NET"><ip-netmask>10.0.0.0/16</ip-netmask></entry>
    <entry name="DMZ"><ip-netmask>192.168.10.0/24</ip-netmask></entry>
  </address>
  <rulebase>
    <security>
      <rules>
        <entry name="allow-web">
          <source><member>CORP-NET</member></source>
          <destination><member>any</member></destination>
          <application><member>web-browsing</member><member>ssl</member></application>
          <service><member>application-default</member></service>
          <action>allow</action>
          <log-end>yes</log-end>
        </entry>
      </rules>
    </security>
  </rulebase>
`);

describe('importPanPolicy — vsys XML', () => {
  it('rejects non-XML input', () => {
    expect(() => importPanPolicy('config firewall address')).toThrow();
  });

  it('creates SmartGroups for address objects referenced by policies', () => {
    const { topology } = importPanPolicy(BASIC_XML);
    const names = topology.smartGroups.map((g) => g.name);
    expect(names).toContain('CORP-NET');
  });

  it('maps ip-netmask to CIDR criterion', () => {
    const { topology } = importPanPolicy(BASIC_XML);
    const sg = topology.smartGroups.find((g) => g.name === 'CORP-NET')!;
    expect(sg.criteria).toEqual([{ type: 'subnet', cidr: '10.0.0.0/16' }]);
  });

  it('seeds sg-any and sg-internet', () => {
    const { topology } = importPanPolicy(BASIC_XML);
    expect(topology.smartGroups.find((g) => g.id === 'sg-any')).toBeDefined();
    expect(topology.smartGroups.find((g) => g.id === 'sg-internet')).toBeDefined();
  });

  it('maps "any" destination to sg-any', () => {
    const { topology } = importPanPolicy(BASIC_XML);
    expect(topology.policies[0]!.dstGroupId).toStrictEqual(['sg-any']);
  });

  it('fans out application-default with multiple App-IDs into N policies', () => {
    const { topology } = importPanPolicy(BASIC_XML);
    // web-browsing (TCP 80) + ssl (TCP 443) = 2 DCF policies
    const rules = topology.policies.filter((p) => p.name.startsWith('allow-web'));
    expect(rules).toHaveLength(2);
    const ports = rules.map((p) => p.ports);
    expect(ports).toContain('80');
    expect(ports).toContain('443');
  });

  it('maps action allow/deny correctly', () => {
    const xml = vsysXml(`
      <rulebase><security><rules>
        <entry name="block-all">
          <source><member>any</member></source>
          <destination><member>any</member></destination>
          <application><member>any</member></application>
          <service><member>any</member></service>
          <action>deny</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { topology } = importPanPolicy(xml);
    expect(topology.policies[0]!.action).toBe('deny');
  });

  it('resolves explicit service entry port ranges', () => {
    const xml = vsysXml(`
      <address>
        <entry name="SRC"><ip-netmask>10.0.0.0/8</ip-netmask></entry>
      </address>
      <service>
        <entry name="svc-app">
          <protocol><tcp><port>8443</port></tcp></protocol>
        </entry>
      </service>
      <rulebase><security><rules>
        <entry name="allow-app">
          <source><member>SRC</member></source>
          <destination><member>any</member></destination>
          <application><member>any</member></application>
          <service><member>svc-app</member></service>
          <action>allow</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { topology } = importPanPolicy(xml);
    expect(topology.policies[0]!.protocol).toBe('tcp');
    expect(topology.policies[0]!.ports).toBe('8443');
  });

  it('resolves address-group static members into merged SmartGroup', () => {
    const xml = vsysXml(`
      <address>
        <entry name="NET-A"><ip-netmask>10.1.0.0/16</ip-netmask></entry>
        <entry name="NET-B"><ip-netmask>10.2.0.0/16</ip-netmask></entry>
      </address>
      <address-group>
        <entry name="ALL-INTERNAL">
          <static>
            <member>NET-A</member>
            <member>NET-B</member>
          </static>
        </entry>
      </address-group>
      <rulebase><security><rules>
        <entry name="allow-int">
          <source><member>ALL-INTERNAL</member></source>
          <destination><member>any</member></destination>
          <application><member>any</member></application>
          <service><member>any</member></service>
          <action>allow</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { topology } = importPanPolicy(xml);
    const sg = topology.smartGroups.find((g) => g.name === 'ALL-INTERNAL')!;
    expect(sg).toBeDefined();
    expect(sg.criteria).toHaveLength(2);
    expect(sg.criteria.map((c) => c.cidr)).toEqual(
      expect.arrayContaining(['10.1.0.0/16', '10.2.0.0/16']),
    );
  });

  it('resolves service-group members', () => {
    const xml = vsysXml(`
      <service>
        <entry name="svc-8080"><protocol><tcp><port>8080</port></tcp></protocol></entry>
        <entry name="svc-8443"><protocol><tcp><port>8443</port></tcp></protocol></entry>
      </service>
      <service-group>
        <entry name="app-ports">
          <members>
            <member>svc-8080</member>
            <member>svc-8443</member>
          </members>
        </entry>
      </service-group>
      <rulebase><security><rules>
        <entry name="allow-app">
          <source><member>any</member></source>
          <destination><member>any</member></destination>
          <application><member>any</member></application>
          <service><member>app-ports</member></service>
          <action>allow</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { topology } = importPanPolicy(xml);
    expect(topology.policies).toHaveLength(2);
    const ports = topology.policies.map((p) => p.ports);
    expect(ports).toContain('8080');
    expect(ports).toContain('8443');
  });

  it('records FQDN address in warnings', () => {
    const xml = vsysXml(`
      <address>
        <entry name="GITHUB"><fqdn>github.com</fqdn></entry>
      </address>
      <rulebase><security><rules>
        <entry name="allow-github">
          <source><member>any</member></source>
          <destination><member>GITHUB</member></destination>
          <application><member>ssl</member></application>
          <service><member>application-default</member></service>
          <action>allow</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { warnings } = importPanPolicy(xml);
    expect(warnings.some((w) => w.includes('FQDN'))).toBe(true);
  });

  it('maps ip-range address to warning', () => {
    const xml = vsysXml(`
      <address>
        <entry name="RANGE"><ip-range>10.0.0.1-10.0.0.254</ip-range></entry>
      </address>
      <rulebase><security><rules>
        <entry name="p1">
          <source><member>RANGE</member></source>
          <destination><member>any</member></destination>
          <application><member>any</member></application>
          <service><member>any</member></service>
          <action>allow</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { warnings } = importPanPolicy(xml);
    expect(warnings.some((w) => w.includes('IP range'))).toBe(true);
  });

  it('assigns ascending priorities across rules', () => {
    const xml = vsysXml(`
      <rulebase><security><rules>
        <entry name="first">
          <source><member>any</member></source><destination><member>any</member></destination>
          <application><member>any</member></application><service><member>any</member></service>
          <action>allow</action>
        </entry>
        <entry name="second">
          <source><member>any</member></source><destination><member>any</member></destination>
          <application><member>any</member></application><service><member>any</member></service>
          <action>deny</action>
        </entry>
      </rules></security></rulebase>
    `);
    const { topology } = importPanPolicy(xml);
    expect(topology.policies[0]!.priority).toBeLessThan(topology.policies[1]!.priority);
  });

  it('collects rules from pre-rulebase and post-rulebase (Panorama)', () => {
    const xml = `<?xml version="1.0"?>
<config>
  <devices>
    <entry name="localhost.localdomain">
      <device-group>
        <entry name="DG-PROD">
          <address>
            <entry name="CORP"><ip-netmask>10.0.0.0/8</ip-netmask></entry>
          </address>
          <pre-rulebase>
            <security><rules>
              <entry name="pre-rule">
                <source><member>CORP</member></source>
                <destination><member>any</member></destination>
                <application><member>web-browsing</member></application>
                <service><member>application-default</member></service>
                <action>allow</action>
              </entry>
            </rules></security>
          </pre-rulebase>
          <post-rulebase>
            <security><rules>
              <entry name="post-deny">
                <source><member>any</member></source>
                <destination><member>any</member></destination>
                <application><member>any</member></application>
                <service><member>any</member></service>
                <action>deny</action>
              </entry>
            </rules></security>
          </post-rulebase>
        </entry>
      </device-group>
    </entry>
  </devices>
</config>`;
    const { topology } = importPanPolicy(xml);
    const names = topology.policies.map((p) => p.name);
    expect(names).toContain('pre-rule');
    expect(names).toContain('post-deny');
  });

  it('collects objects and rules from Panorama shared scope', () => {
    const xml = `<?xml version="1.0"?>
<config>
  <shared>
    <address>
      <entry name="SHARED-NET"><ip-netmask>172.16.0.0/12</ip-netmask></entry>
    </address>
    <pre-rulebase>
      <security><rules>
        <entry name="shared-rule">
          <source><member>SHARED-NET</member></source>
          <destination><member>any</member></destination>
          <application><member>dns</member></application>
          <service><member>application-default</member></service>
          <action>allow</action>
        </entry>
      </rules></security>
    </pre-rulebase>
  </shared>
</config>`;
    const { topology } = importPanPolicy(xml);
    expect(topology.policies.find((p) => p.name === 'shared-rule')).toBeDefined();
    const sg = topology.smartGroups.find((g) => g.name === 'SHARED-NET')!;
    expect(sg?.criteria[0]?.cidr).toBe('172.16.0.0/12');
  });

  it('maps well-known App-IDs to correct protocols', () => {
    const appCases: Array<[string, string, string]> = [
      ['dns', 'udp', '53'],
      ['ssh', 'tcp', '22'],
      ['ping', 'icmp', ''],
    ];
    for (const [app, proto, ports] of appCases) {
      const xml = vsysXml(`
        <rulebase><security><rules>
          <entry name="rule-${app}">
            <source><member>any</member></source>
            <destination><member>any</member></destination>
            <application><member>${app}</member></application>
            <service><member>application-default</member></service>
            <action>allow</action>
          </entry>
        </rules></security></rulebase>
      `);
      const { topology } = importPanPolicy(xml);
      const pol = topology.policies[0]!;
      expect(pol.protocol).toBe(proto);
      if (ports) expect(pol.ports).toBe(ports);
    }
  });
});
