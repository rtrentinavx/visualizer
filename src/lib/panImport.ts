import { XMLParser } from 'fast-xml-parser';
import {
  buildDcfModel,
  type RawAddress,
  type RawAddrGroup,
  type RawService,
  type RawPolicy,
  type FirewallImportReport,
} from './firewallImportShared';

export type { FirewallImportReport as PanImportReport };

// ─── Well-known PAN App-IDs and built-in services ────────────────────────────

const PAN_KNOWN: Record<string, { protocol: RawService['protocol']; ports?: string }> = {
  // Built-in services
  'service-http': { protocol: 'tcp', ports: '80' },
  'service-https': { protocol: 'tcp', ports: '443' },
  // App-IDs
  'web-browsing': { protocol: 'tcp', ports: '80' },
  'ssl': { protocol: 'tcp', ports: '443' },
  'dns': { protocol: 'udp', ports: '53' },
  'ssh': { protocol: 'tcp', ports: '22' },
  'ftp': { protocol: 'tcp', ports: '21' },
  'smtp': { protocol: 'tcp', ports: '25' },
  'pop3': { protocol: 'tcp', ports: '110' },
  'imap': { protocol: 'tcp', ports: '143' },
  'imap-ssl': { protocol: 'tcp', ports: '993' },
  'pop3-ssl': { protocol: 'tcp', ports: '995' },
  'smtp-ssl': { protocol: 'tcp', ports: '465' },
  'telnet': { protocol: 'tcp', ports: '23' },
  'ldap': { protocol: 'tcp', ports: '389' },
  'ldaps': { protocol: 'tcp', ports: '636' },
  'kerberos': { protocol: 'tcp', ports: '88' },
  'rdp': { protocol: 'tcp', ports: '3389' },
  'msrpc': { protocol: 'tcp', ports: '135' },
  'msrpc-base': { protocol: 'tcp', ports: '135' },
  'smb': { protocol: 'tcp', ports: '445' },
  'netbios-ss': { protocol: 'tcp', ports: '445' },
  'mysql': { protocol: 'tcp', ports: '3306' },
  'mssql-db': { protocol: 'tcp', ports: '1433' },
  'oracle-db': { protocol: 'tcp', ports: '1521' },
  'postgresql': { protocol: 'tcp', ports: '5432' },
  'ntp': { protocol: 'udp', ports: '123' },
  'snmp': { protocol: 'udp', ports: '161' },
  'syslog': { protocol: 'udp', ports: '514' },
  'icmp': { protocol: 'icmp' },
  'ping': { protocol: 'icmp' },
  'any': { protocol: 'any' },
};

function seedKnown(services: Map<string, RawService>): void {
  for (const [name, svc] of Object.entries(PAN_KNOWN)) {
    if (!services.has(name)) services.set(name, { name, ...svc });
  }
}

// ─── XML parser ───────────────────────────────────────────────────────────────

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['entry', 'member'].includes(name),
  parseTagValue: false,
});

type PObj = Record<string, unknown>;

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function members(container: unknown): string[] {
  if (!container || typeof container !== 'object') return [];
  if (Array.isArray(container)) return (container as unknown[]).map(str).filter(Boolean);
  const obj = container as PObj;
  if (Array.isArray(obj['member'])) return (obj['member'] as unknown[]).map(str).filter(Boolean);
  return [];
}

function entries(container: unknown): PObj[] {
  if (!container || typeof container !== 'object') return [];
  const obj = container as PObj;
  if (Array.isArray(obj['entry'])) return obj['entry'] as PObj[];
  return [];
}

// ─── Context collector ────────────────────────────────────────────────────────
// PAN configs can have objects and rules in multiple places:
//   - devices/entry[]/vsys/entry[]            (single firewall)
//   - devices/entry[]/device-group/entry[]    (Panorama)
//   - shared/                                  (Panorama shared scope)
// We walk all of them and merge into one set of maps.

interface Intermediate {
  addresses: Map<string, RawAddress>;
  addrGroups: Map<string, RawAddrGroup>;
  services: Map<string, RawService>;
  serviceGroups: Map<string, string[]>;
  policies: RawPolicy[];
}

function parseContext(ctx: PObj, out: Intermediate): void {
  // Addresses
  for (const e of entries(ctx['address'])) {
    const name = str(e['@_name']);
    if (!name) continue;
    const addr: RawAddress = { name, type: 'unknown' };
    if (e['ip-netmask']) {
      addr.type = 'ipmask'; addr.cidr = str(e['ip-netmask']);
    } else if (e['fqdn']) {
      addr.type = 'fqdn'; addr.fqdn = str(e['fqdn']);
    } else if (e['ip-range']) {
      const parts = str(e['ip-range']).split('-');
      addr.type = 'iprange'; addr.startIp = parts[0]; addr.endIp = parts[1];
    } else if (e['ip-wildcard']) {
      addr.type = 'wildcard';
    }
    out.addresses.set(name, addr);
  }

  // Address groups
  for (const e of entries(ctx['address-group'])) {
    const name = str(e['@_name']);
    if (!name) continue;
    const staticMembers = members(e['static']);
    // dynamic groups (tag-based) have no CIDR equivalent — record with empty members
    out.addrGroups.set(name, { name, members: staticMembers });
  }

  // Services
  for (const e of entries(ctx['service'])) {
    const name = str(e['@_name']);
    if (!name) continue;
    const proto = e['protocol'] as PObj | undefined;
    if (!proto) continue;
    let protocol: RawService['protocol'] = 'any';
    let ports: string | undefined;
    if (proto['tcp']) {
      protocol = 'tcp';
      ports = str((proto['tcp'] as PObj)['port']) || undefined;
    } else if (proto['udp']) {
      protocol = 'udp';
      ports = str((proto['udp'] as PObj)['port']) || undefined;
    } else if (proto['icmp'] || proto['icmp6']) {
      protocol = 'icmp';
    }
    out.services.set(name, { name, protocol, ports });
  }

  // Service groups
  for (const e of entries(ctx['service-group'])) {
    const name = str(e['@_name']);
    if (!name) continue;
    out.serviceGroups.set(name, members(e['members']));
  }

  // Rules — collect from rulebase, pre-rulebase, post-rulebase
  for (const rbKey of ['rulebase', 'pre-rulebase', 'post-rulebase']) {
    const rb = ctx[rbKey] as PObj | undefined;
    if (!rb) continue;
    const sec = rb['security'] as PObj | undefined;
    if (!sec) continue;
    const rules = sec['rules'] as PObj | undefined;
    if (!rules) continue;
    for (const e of entries(rules)) {
      const name = str(e['@_name']);
      if (!name) continue;
      const actionRaw = str(e['action']);
      const action: 'allow' | 'deny' =
        actionRaw === 'allow' ? 'allow' : 'deny';
      const logging = str(e['log-end']) === 'yes' || str(e['log-start']) === 'yes';
      const svcMembers = members(e['service']);
      const appMembers = members(e['application']);

      // Service resolution: 'application-default' → use App-ID names; 'any' → protocol any
      let svcs: string[];
      if (svcMembers.includes('any')) {
        svcs = ['any'];
      } else if (svcMembers.length === 0 || svcMembers.every((s) => s === 'application-default')) {
        svcs = appMembers.filter((a) => a !== 'any');
        if (svcs.length === 0 || appMembers.includes('any')) svcs = ['any'];
      } else {
        svcs = svcMembers;
      }

      out.policies.push({
        id: name,
        name,
        srcAddrs: members(e['source']),
        dstAddrs: members(e['destination']),
        services: svcs,
        action,
        logging,
      });
    }
  }
}

function panXmlToIntermediate(root: PObj): Intermediate {
  const out: Intermediate = {
    addresses: new Map(),
    addrGroups: new Map(),
    services: new Map(),
    serviceGroups: new Map(),
    policies: [],
  };

  // Walk vsys entries (single firewall)
  for (const dev of entries(root['devices'])) {
    for (const vsys of entries((dev['vsys'] as PObj | undefined) ?? {})) {
      parseContext(vsys, out);
    }
    // Walk device-group entries (Panorama)
    for (const dg of entries((dev['device-group'] as PObj | undefined) ?? {})) {
      parseContext(dg, out);
    }
  }

  // Shared scope (Panorama)
  if (root['shared'] && typeof root['shared'] === 'object') {
    parseContext(root['shared'] as PObj, out);
  }

  seedKnown(out.services);
  return out;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function importPanPolicy(text: string): FirewallImportReport {
  const trimmed = text.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error('PAN import requires XML config. Export via: Device → Setup → Operations → Export running config.');
  }

  const parsed = XML_PARSER.parse(trimmed) as PObj;
  // fast-xml-parser wraps under root element — unwrap one level
  const keys = Object.keys(parsed).filter((k) => k !== '?xml');
  const root = (keys.length === 1 ? parsed[keys[0]!] : parsed) as PObj;

  const { addresses, addrGroups, services, serviceGroups, policies } = panXmlToIntermediate(root);
  return buildDcfModel(addresses, addrGroups, services, serviceGroups, policies);
}
