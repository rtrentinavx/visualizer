import { XMLParser } from 'fast-xml-parser';
import {
  buildDcfModel,
  uid,
  randomColor,
  type RawAddress,
  type RawAddrGroup,
  type RawService,
  type RawPolicy,
  type FirewallImportReport,
} from './firewallImportShared';

export type { FirewallImportReport as FortiImportReport };

// ─── Well-known FortiGate service names ──────────────────────────────────────

const FORTI_KNOWN: Record<string, { protocol: RawService['protocol']; ports?: string }> = {
  HTTP: { protocol: 'tcp', ports: '80' },
  HTTPS: { protocol: 'tcp', ports: '443' },
  DNS: { protocol: 'udp', ports: '53' },
  FTP: { protocol: 'tcp', ports: '21' },
  SSH: { protocol: 'tcp', ports: '22' },
  SMTP: { protocol: 'tcp', ports: '25' },
  SMTPS: { protocol: 'tcp', ports: '465' },
  POP3: { protocol: 'tcp', ports: '110' },
  POP3S: { protocol: 'tcp', ports: '995' },
  IMAP: { protocol: 'tcp', ports: '143' },
  IMAPS: { protocol: 'tcp', ports: '993' },
  TELNET: { protocol: 'tcp', ports: '23' },
  LDAP: { protocol: 'tcp', ports: '389' },
  LDAPS: { protocol: 'tcp', ports: '636' },
  RDP: { protocol: 'tcp', ports: '3389' },
  MYSQL: { protocol: 'tcp', ports: '3306' },
  MSSQL: { protocol: 'tcp', ports: '1433' },
  ORACLE: { protocol: 'tcp', ports: '1521' },
  POSTGRESQL: { protocol: 'tcp', ports: '5432' },
  NTP: { protocol: 'udp', ports: '123' },
  SNMP: { protocol: 'udp', ports: '161' },
  SYSLOG: { protocol: 'udp', ports: '514' },
  PING: { protocol: 'icmp' },
  ALL: { protocol: 'any' },
  ALL_TCP: { protocol: 'tcp' },
  ALL_UDP: { protocol: 'udp' },
  ALL_ICMP: { protocol: 'icmp' },
};

function seedKnown(services: Map<string, RawService>): void {
  for (const [name, svc] of Object.entries(FORTI_KNOWN)) {
    if (!services.has(name)) services.set(name, { name, ...svc });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskToCidr(ip: string, maskOrPrefix: string): string | null {
  if (maskOrPrefix.startsWith('/')) return `${ip}${maskOrPrefix}`;
  if (/^\d+$/.test(maskOrPrefix)) return `${ip}/${maskOrPrefix}`;
  const parts = maskOrPrefix.split('.');
  if (parts.length !== 4) return null;
  let bits = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n)) return null;
    let v = n;
    while (v) { bits += v & 1; v >>>= 1; }
  }
  return `${ip}/${bits}`;
}

// ─── Intermediate representation ─────────────────────────────────────────────

interface Intermediate {
  addresses: Map<string, RawAddress>;
  addrGroups: Map<string, RawAddrGroup>;
  services: Map<string, RawService>;
  serviceGroups: Map<string, string[]>;
  policies: RawPolicy[];
}

// ─── .conf parser ─────────────────────────────────────────────────────────────

interface ConfSection {
  entries: Map<string, Map<string, string[]>>;
}

function parseConf(text: string): Map<string, ConfSection> {
  const sections = new Map<string, ConfSection>();
  const sectionStack: string[] = [];
  let fields: Map<string, string[]> | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const configM = line.match(/^config\s+(.+)$/);
    if (configM) {
      const name = configM[1]!.trim();
      sectionStack.push(name);
      if (!sections.has(name)) sections.set(name, { entries: new Map() });
      fields = null;
      continue;
    }

    if (line === 'end') { sectionStack.pop(); fields = null; continue; }

    const section = sectionStack[sectionStack.length - 1];
    if (!section) continue;

    const editM = line.match(/^edit\s+(.+)$/);
    if (editM) {
      const key = editM[1]!.trim().replace(/^"(.*)"$/, '$1');
      fields = new Map();
      sections.get(section)!.entries.set(key, fields);
      continue;
    }

    if (line === 'next') { fields = null; continue; }

    const setM = line.match(/^set\s+(\S+)\s+(.*)$/);
    if (setM && fields) {
      const values: string[] = [];
      const re = /"([^"]*)"|\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(setM[2]!.trim())) !== null) {
        values.push(m[1] !== undefined ? m[1] : m[0]!);
      }
      fields.set(setM[1]!, values);
    }
  }

  return sections;
}

function confToIntermediate(sections: Map<string, ConfSection>): Intermediate {
  const addresses = new Map<string, RawAddress>();
  const addrGroups = new Map<string, RawAddrGroup>();
  const services = new Map<string, RawService>();
  const serviceGroups = new Map<string, string[]>();
  const policies: RawPolicy[] = [];

  const f = (fields: Map<string, string[]>, key: string) => fields.get(key) ?? [];

  const addrSec = sections.get('firewall address');
  if (addrSec) {
    for (const [name, fields] of addrSec.entries) {
      const typeRaw = f(fields, 'type')[0] ?? 'ipmask';
      const addr: RawAddress = { name, type: 'unknown' };
      if (typeRaw === 'ipmask') {
        const sub = f(fields, 'subnet');
        if (sub.length >= 2) {
          const cidr = maskToCidr(sub[0]!, sub[1]!);
          if (cidr) { addr.type = 'ipmask'; addr.cidr = cidr; }
        } else if (sub.length === 1 && sub[0]!.includes('/')) {
          addr.type = 'ipmask'; addr.cidr = sub[0];
        }
      } else if (typeRaw === 'fqdn') {
        addr.type = 'fqdn'; addr.fqdn = f(fields, 'fqdn')[0];
      } else if (typeRaw === 'iprange') {
        addr.type = 'iprange'; addr.startIp = f(fields, 'start-ip')[0]; addr.endIp = f(fields, 'end-ip')[0];
      } else if (typeRaw === 'geography') {
        addr.type = 'geography';
      } else if (typeRaw === 'wildcard') {
        addr.type = 'wildcard';
      } else if (typeRaw === 'dynamic') {
        addr.type = 'dynamic';
      }
      addresses.set(name, addr);
    }
  }

  const grpSec = sections.get('firewall addrgrp');
  if (grpSec) {
    for (const [name, fields] of grpSec.entries) {
      addrGroups.set(name, { name, members: f(fields, 'member') });
    }
  }

  const svcSec = sections.get('firewall service custom');
  if (svcSec) {
    for (const [name, fields] of svcSec.entries) {
      const proto = (f(fields, 'protocol')[0] ?? 'TCP').toLowerCase();
      let protocol: RawService['protocol'] = 'any';
      const ports: string[] = [];
      if (proto === 'tcp/udp/sctp' || proto === 'tcp') {
        protocol = 'tcp';
        ports.push(...f(fields, 'tcp-portrange').map((r) => r.split(':')[0]!));
      } else if (proto === 'udp') {
        protocol = 'udp';
        ports.push(...f(fields, 'udp-portrange').map((r) => r.split(':')[0]!));
      } else if (proto.startsWith('icmp')) {
        protocol = 'icmp';
      }
      services.set(name, { name, protocol, ports: ports.length > 0 ? ports.join(',') : undefined });
    }
  }

  const svcGrpSec = sections.get('firewall service group');
  if (svcGrpSec) {
    for (const [name, fields] of svcGrpSec.entries) {
      serviceGroups.set(name, f(fields, 'member'));
    }
  }

  const polSec = sections.get('firewall policy');
  if (polSec) {
    for (const [id, fields] of polSec.entries) {
      const logtraffic = f(fields, 'logtraffic')[0];
      policies.push({
        id,
        name: f(fields, 'name')[0] ?? `Policy ${id}`,
        srcAddrs: f(fields, 'srcaddr'),
        dstAddrs: f(fields, 'dstaddr'),
        services: f(fields, 'service'),
        action: f(fields, 'action')[0] === 'accept' ? 'allow' : 'deny',
        logging: logtraffic === 'all' || logtraffic === 'utm',
      });
    }
  }

  seedKnown(services);
  return { addresses, addrGroups, services, serviceGroups, policies };
}

// ─── XML parser ───────────────────────────────────────────────────────────────

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['table', 'entry', 'list', 'member'].includes(name),
  parseTagValue: false,
});

type FgObj = Record<string, unknown>;

function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

function getListMembers(container: unknown): string[] {
  if (!container) return [];
  if (Array.isArray(container)) {
    if (container.length === 0) return [];
    const first = container[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const listVal = (first as FgObj)['list'];
      if (Array.isArray(listVal)) return (listVal as unknown[]).map(str).filter(Boolean);
    }
    return (container as unknown[]).flatMap((v) => str(v).split(/\s+/)).filter(Boolean);
  }
  if (typeof container === 'object') {
    const obj = container as FgObj;
    if (Array.isArray(obj['list'])) return (obj['list'] as unknown[]).map(str).filter(Boolean);
    return [];
  }
  return str(container).split(/\s+/).filter(Boolean);
}

function xmlToIntermediate(root: FgObj): Intermediate {
  const addresses = new Map<string, RawAddress>();
  const addrGroups = new Map<string, RawAddrGroup>();
  const services = new Map<string, RawService>();
  const serviceGroups = new Map<string, string[]>();
  const policies: RawPolicy[] = [];

  function getEntries(sectionId: string): FgObj[] {
    const result: FgObj[] = [];
    const tables = Object.values(root)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v): v is FgObj => !!v && typeof v === 'object' && str((v as FgObj)['@_name']) === sectionId);
    for (const table of tables) {
      if (Array.isArray(table['entry'])) result.push(...(table['entry'] as FgObj[]));
    }
    const tagKey = sectionId.replace(/\s+/g, '_');
    const tagVal = root[tagKey];
    if (tagVal && typeof tagVal === 'object' && !Array.isArray(tagVal)) {
      const entries = (tagVal as FgObj)['entry'];
      if (Array.isArray(entries)) result.push(...(entries as FgObj[]));
    }
    return result;
  }

  for (const entry of getEntries('firewall address')) {
    const name = str(entry['@_name']) || str(entry['name']);
    if (!name) continue;
    const typeRaw = str(entry['type']) || 'ipmask';
    const addr: RawAddress = { name, type: 'unknown' };
    if (typeRaw === 'ipmask') {
      const subRaw = str(entry['subnet']);
      const parts = subRaw.split(/\s+/);
      if (parts.length >= 2) {
        const cidr = maskToCidr(parts[0]!, parts[1]!);
        if (cidr) { addr.type = 'ipmask'; addr.cidr = cidr; }
      } else if (parts.length === 1 && parts[0]!.includes('/')) {
        addr.type = 'ipmask'; addr.cidr = parts[0];
      }
    } else if (typeRaw === 'fqdn') {
      addr.type = 'fqdn'; addr.fqdn = str(entry['fqdn']);
    } else if (typeRaw === 'iprange') {
      addr.type = 'iprange'; addr.startIp = str(entry['start-ip']); addr.endIp = str(entry['end-ip']);
    } else if (typeRaw === 'geography') {
      addr.type = 'geography';
    } else if (typeRaw === 'wildcard') {
      addr.type = 'wildcard';
    }
    addresses.set(name, addr);
  }

  for (const entry of getEntries('firewall addrgrp')) {
    const name = str(entry['@_name']) || str(entry['name']);
    if (!name) continue;
    addrGroups.set(name, { name, members: getListMembers(entry['member']) });
  }

  for (const entry of getEntries('firewall service custom')) {
    const name = str(entry['@_name']) || str(entry['name']);
    if (!name) continue;
    const proto = str(entry['protocol']).toLowerCase() || 'tcp';
    let protocol: RawService['protocol'] = 'any';
    const ports: string[] = [];
    if (proto === 'tcp/udp/sctp' || proto === 'tcp') {
      protocol = 'tcp';
      const r = str(entry['tcp-portrange']);
      if (r) ports.push(...r.split(/\s+/).map((s) => s.split(':')[0]!));
    } else if (proto === 'udp') {
      protocol = 'udp';
      const r = str(entry['udp-portrange']);
      if (r) ports.push(...r.split(/\s+/).map((s) => s.split(':')[0]!));
    } else if (proto.startsWith('icmp')) {
      protocol = 'icmp';
    }
    services.set(name, { name, protocol, ports: ports.length > 0 ? ports.join(',') : undefined });
  }

  for (const entry of getEntries('firewall service group')) {
    const name = str(entry['@_name']) || str(entry['name']);
    if (!name) continue;
    serviceGroups.set(name, getListMembers(entry['member']));
  }

  for (const entry of getEntries('firewall policy')) {
    const id = str(entry['@_id']) || str(entry['@_name']) || str(entry['policyid']);
    const name = str(entry['name']) || `Policy ${id}`;
    const logtraffic = str(entry['logtraffic']);
    policies.push({
      id,
      name,
      srcAddrs: getListMembers(entry['srcaddr']),
      dstAddrs: getListMembers(entry['dstaddr']),
      services: getListMembers(entry['service']),
      action: str(entry['action']) === 'accept' ? 'allow' : 'deny',
      logging: logtraffic === 'all' || logtraffic === 'utm',
    });
  }

  seedKnown(services);
  return { addresses, addrGroups, services, serviceGroups, policies };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function importFortiPolicy(text: string): FirewallImportReport {
  const trimmed = text.trim();
  let intermediate: Intermediate;

  if (trimmed.startsWith('<')) {
    const parsed = XML_PARSER.parse(trimmed) as FgObj;
    const keys = Object.keys(parsed).filter((k) => k !== '?xml');
    const root = (keys.length === 1 ? parsed[keys[0]!] : parsed) as FgObj;
    intermediate = xmlToIntermediate(root);
  } else {
    intermediate = confToIntermediate(parseConf(trimmed));
  }

  const { addresses, addrGroups, services, serviceGroups, policies } = intermediate;
  return buildDcfModel(addresses, addrGroups, services, serviceGroups, policies);
}

// Re-export buildDcfModel for tests that import it directly
export { buildDcfModel } from './firewallImportShared';
export { uid, randomColor };
