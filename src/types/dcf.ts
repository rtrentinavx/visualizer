export interface Vpc {
  id: string;
  name: string;
  cidr: string;
  account: string;
}

export type GatewayType = 'transit' | 'spoke';

export interface Gateway {
  id: string;
  name: string;
  type: GatewayType;
  vpcId: string;
  haEnabled: boolean;
  ip?: string;
}

export interface SmartGroup {
  id: string;
  name: string;
  color: string;
  criteria: SmartGroupCriteria[];
  workloadCount: number;
  vpcIds: string[];
}

export interface SmartGroupCriteria {
  key: string;
  operator: 'equals' | 'contains' | 'startsWith';
  value: string;
}

export type PolicyAction = 'allow' | 'deny';
export type PolicyDirection = 'inbound' | 'outbound' | 'any';
export type Protocol = 'tcp' | 'udp' | 'icmp' | 'any';

export interface DcfPolicy {
  id: string;
  name: string;
  priority: number;
  srcGroupId: string;
  dstGroupId: string;
  action: PolicyAction;
  direction: PolicyDirection;
  protocol: Protocol;
  ports?: string;
  logging: boolean;
  decrypt?: boolean;
  threatGroup?: string;
  geoGroup?: string;
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

export interface TrafficFlow {
  id: string;
  srcGroupId: string;
  dstGroupId: string;
  protocol: Protocol;
  port: number;
  bytes: number;
  packets: number;
  allowed: boolean;
  timestamp: string;
}

export interface DcfTopology {
  vpcs: Vpc[];
  gateways: Gateway[];
  smartGroups: SmartGroup[];
  policies: DcfPolicy[];
  threatGroups: ThreatGroup[];
  geoGroups: GeoGroup[];
  flows: TrafficFlow[];
}
