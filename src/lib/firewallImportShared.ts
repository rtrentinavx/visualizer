import type { DcfPolicyModel, SmartGroup, DcfPolicy, SmartGroupCriteria } from '../types/dcf';

// Shared types and model builder used by FortiGate and PAN importers.
// Callers are responsible for seeding the services map with well-known entries
// before calling buildDcfModel — there are no hardcoded service names here.

export interface RawAddress {
  name: string;
  type: 'ipmask' | 'fqdn' | 'iprange' | 'geography' | 'wildcard' | 'dynamic' | 'unknown';
  cidr?: string;
  fqdn?: string;
  startIp?: string;
  endIp?: string;
}

export interface RawAddrGroup {
  name: string;
  members: string[];
}

export interface RawService {
  name: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  ports?: string;
}

export interface RawPolicy {
  id: string;
  name: string;
  srcAddrs: string[];
  dstAddrs: string[];
  services: string[];
  action: 'allow' | 'deny';
  logging: boolean;
}

export interface FirewallImportReport {
  topology: DcfPolicyModel;
  warnings: string[];
}

export const COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#10b981'];

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)]!;
}

export function flattenAddrs(
  name: string,
  addresses: Map<string, RawAddress>,
  addrGroups: Map<string, RawAddrGroup>,
  visited = new Set<string>(),
): RawAddress[] {
  if (visited.has(name)) return [];
  visited.add(name);
  const lower = name.toLowerCase();
  if (lower === 'all' || lower === 'any' || lower === 'any-ipv4') {
    return [{ name: 'all', type: 'ipmask', cidr: '0.0.0.0/0' }];
  }
  const addr = addresses.get(name);
  if (addr) return [addr];
  const grp = addrGroups.get(name);
  if (grp) return grp.members.flatMap((m) => flattenAddrs(m, addresses, addrGroups, visited));
  return [];
}

function resolveServices(
  name: string,
  services: Map<string, RawService>,
  serviceGroups: Map<string, string[]>,
  visited = new Set<string>(),
): RawService[] {
  if (visited.has(name)) return [];
  visited.add(name);
  const svc = services.get(name);
  if (svc) return [svc];
  const grp = serviceGroups.get(name);
  if (grp) return grp.flatMap((m) => resolveServices(m, services, serviceGroups, visited));
  return [];
}

export function buildDcfModel(
  addresses: Map<string, RawAddress>,
  addrGroups: Map<string, RawAddrGroup>,
  services: Map<string, RawService>,
  serviceGroups: Map<string, string[]>,
  rawPolicies: RawPolicy[],
): { topology: DcfPolicyModel; warnings: string[] } {
  const warnings: string[] = [];
  const sgMap = new Map<string, SmartGroup>();
  sgMap.set('sg-any', { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' });
  sgMap.set('sg-internet', { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' });

  function getOrCreateGroup(addrNames: string[]): string {
    if (addrNames.length === 0) return 'sg-any';
    const allAddrs = addrNames.flatMap((n) => flattenAddrs(n, addresses, addrGroups));
    if (allAddrs.length === 0 || allAddrs.some((a) => a.cidr === '0.0.0.0/0')) return 'sg-any';

    const key = addrNames.join('+');
    const existing = sgMap.get(key);
    if (existing) return existing.id;

    const criteria: SmartGroupCriteria[] = [];
    for (const a of allAddrs) {
      if (a.type === 'ipmask' && a.cidr) {
        criteria.push({ type: 'subnet', cidr: a.cidr });
      } else if (a.type === 'fqdn') {
        warnings.push(`FQDN address "${a.name}" (${a.fqdn ?? ''}) — no SmartGroup equivalent, skipped`);
      } else if (a.type === 'iprange') {
        warnings.push(`IP range "${a.name}" (${a.startIp ?? ''}–${a.endIp ?? ''}) — convert to CIDR manually`);
      } else if (a.type === 'geography') {
        warnings.push(`Geography address "${a.name}" — use GeoGroups in DCF`);
      } else if (a.type !== 'unknown') {
        warnings.push(`Address "${a.name}" (type: ${a.type}) — skipped`);
      }
    }

    const sg: SmartGroup = {
      id: uid('sg'),
      name: addrNames.length === 1 ? addrNames[0]! : key,
      color: randomColor(),
      criteria,
      matchType: 'any',
    };
    sgMap.set(key, sg);
    return sg.id;
  }

  const dcfPolicies: DcfPolicy[] = [];
  rawPolicies.forEach((rp, idx) => {
    const srcId = getOrCreateGroup(rp.srcAddrs);
    const dstId = getOrCreateGroup(rp.dstAddrs);
    const resolvedSvcs = rp.services.flatMap((s) => resolveServices(s, services, serviceGroups));
    const base = (idx + 1) * 10;

    if (resolvedSvcs.length === 0) {
      dcfPolicies.push({
        id: uid('pol'),
        name: rp.name,
        priority: base,
        srcGroupId: srcId,
        dstGroupId: dstId,
        action: rp.action,
        protocol: 'any',
        logging: rp.logging,
      });
    } else {
      resolvedSvcs.forEach((svc, si) => {
        dcfPolicies.push({
          id: uid('pol'),
          name: resolvedSvcs.length > 1 ? `${rp.name} (${svc.name})` : rp.name,
          priority: base + si,
          srcGroupId: srcId,
          dstGroupId: dstId,
          action: rp.action,
          protocol: svc.protocol,
          ports: svc.ports,
          logging: rp.logging,
        });
      });
    }
  });

  return {
    topology: {
      smartGroups: Array.from(sgMap.values()),
      webGroups: [],
      threatGroups: [],
      geoGroups: [],
      policies: dcfPolicies,
      flows: [],
    },
    warnings,
  };
}
