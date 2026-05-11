export interface SmartGroup {
  id: string;
  name: string;
  color: string;
  criteria: SmartGroupCriteria[];
  matchType: 'any' | 'all';
}

export interface SmartGroupCriteria {
  type: 'vm' | 'subnet';
  key?: string;
  operator?: 'equals' | 'contains' | 'startsWith';
  value?: string;
  cidr?: string;
}

export interface WebGroup {
  id: string;
  name: string;
  fqdns: string[];
}

export interface ThreatGroup {
  id: string;
  name: string;
  category: 'malware' | 'botnet' | 'phishing' | 'anonymous' | 'custom';
  entryCount: number;
}

export interface GeoGroup {
  id: string;
  name: string;
  countries: string[];
}

export type PolicyAction = 'allow' | 'deny' | 'learned';
export type PolicyDirection = 'inbound' | 'outbound' | 'any';
export type Protocol = 'tcp' | 'udp' | 'icmp' | 'any';

export interface DcfPolicy {
  id: string;
  name: string;
  priority: number;
  srcGroupId: string;
  dstGroupId: string;
  srcExcludeGroupIds?: string[];
  dstExcludeGroupIds?: string[];
  action: PolicyAction;
  protocol: Protocol;
  ports?: string;
  logging: boolean;
  enforcement?: boolean;
  decrypt?: boolean;
  threatGroup?: string;
  geoGroup?: string;
  webGroupIds?: string[];
}

export interface TrafficFlow {
  id: string;
  srcGroupId: string;
  dstGroupId: string;
  protocol: Protocol;
  port: number;
  bytes: number;
  packets: number;
  allowed: boolean;
  direction?: PolicyDirection;
  timestamp: string;
}

export interface DcfPolicyModel {
  smartGroups: SmartGroup[];
  webGroups: WebGroup[];
  threatGroups: ThreatGroup[];
  geoGroups: GeoGroup[];
  policies: DcfPolicy[];
  flows: TrafficFlow[];
}
