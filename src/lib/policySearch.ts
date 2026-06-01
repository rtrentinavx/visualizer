import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';
import type { PolicySearchFilter } from './ai/schemas';

export interface ResolvedPolicySearchFilter {
  srcGroupId?: string;
  dstGroupId?: string;
  dstWebGroupId?: string;
  actions?: Array<'allow' | 'deny' | 'learned'>;
  protocols?: Array<'tcp' | 'udp' | 'icmp' | 'any'>;
  containsPort?: string;
  hasThreatGroup?: boolean;
  hasGeoGroup?: boolean;
  hasWebGroup?: boolean;
  decryptOnly?: boolean;
  loggingDisabled?: boolean;
  unresolvedNames: string[];
}

export function resolveSearchFilter(topology: DcfPolicyModel, raw: PolicySearchFilter): ResolvedPolicySearchFilter {
  const unresolved: string[] = [];
  const result: ResolvedPolicySearchFilter = { unresolvedNames: unresolved };

  if (raw.srcGroupName) {
    const name = raw.srcGroupName.trim();
    if (name.toLowerCase() === 'any') {
      result.srcGroupId = 'sg-any';
    } else {
      const sg = topology.smartGroups.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (sg) result.srcGroupId = sg.id;
      else unresolved.push(`SmartGroup "${name}" (source)`);
    }
  }

  if (raw.dstGroupName) {
    const name = raw.dstGroupName.trim();
    if (name.toLowerCase() === 'internet') {
      result.dstGroupId = 'sg-internet';
    } else if (name.toLowerCase() === 'any') {
      result.dstGroupId = 'sg-any';
    } else {
      const sg = topology.smartGroups.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (sg) result.dstGroupId = sg.id;
      else unresolved.push(`SmartGroup "${name}" (destination)`);
    }
  }

  if (raw.dstWebGroupName) {
    const name = raw.dstWebGroupName.trim();
    const wg = topology.webGroups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (wg) result.dstWebGroupId = wg.id;
    else unresolved.push(`WebGroup "${name}"`);
  }

  if (raw.actions && raw.actions.length > 0) result.actions = raw.actions;
  if (raw.protocols && raw.protocols.length > 0) result.protocols = raw.protocols;
  if (raw.containsPort) result.containsPort = raw.containsPort.trim();
  if (raw.hasThreatGroup !== undefined) result.hasThreatGroup = raw.hasThreatGroup;
  if (raw.hasGeoGroup !== undefined) result.hasGeoGroup = raw.hasGeoGroup;
  if (raw.hasWebGroup !== undefined) result.hasWebGroup = raw.hasWebGroup;
  if (raw.decryptOnly !== undefined) result.decryptOnly = raw.decryptOnly;
  if (raw.loggingDisabled !== undefined) result.loggingDisabled = raw.loggingDisabled;

  return result;
}

export function searchPolicies(topology: DcfPolicyModel, filter: ResolvedPolicySearchFilter): DcfPolicy[] {
  return topology.policies.filter((p) => {
    if (filter.srcGroupId && !p.srcGroupId.includes(filter.srcGroupId) && filter.srcGroupId !== 'sg-any') return false;
    if (filter.dstGroupId && !p.dstGroupId.includes(filter.dstGroupId) && filter.dstGroupId !== 'sg-any') return false;
    if (filter.dstWebGroupId && !(p.webGroupIds?.includes(filter.dstWebGroupId))) return false;
    if (filter.actions && !filter.actions.includes(p.action)) return false;
    if (filter.protocols && !filter.protocols.includes(p.protocol)) return false;
    if (filter.containsPort) {
      const policyPorts = (p.ports ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!policyPorts.includes(filter.containsPort)) return false;
    }
    if (filter.hasThreatGroup !== undefined) {
      const has = !!p.threatGroup;
      if (has !== filter.hasThreatGroup) return false;
    }
    if (filter.hasGeoGroup !== undefined) {
      const has = !!p.geoGroup;
      if (has !== filter.hasGeoGroup) return false;
    }
    if (filter.hasWebGroup !== undefined) {
      const has = !!(p.webGroupIds && p.webGroupIds.length > 0);
      if (has !== filter.hasWebGroup) return false;
    }
    if (filter.decryptOnly === true && !p.decrypt) return false;
    if (filter.loggingDisabled === true && p.logging !== false) return false;
    return true;
  });
}
