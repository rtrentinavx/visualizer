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
  primaryIp?: string;
  haIp?: string;
  asn?: number; // BGP ASN, transit gateways only
}

export interface SecurityDomain {
  id: string;
  name: string;
  color: string;
}

export interface SmartGroup {
  id: string;
  name: string;
  color: string;
  criteria: SmartGroupCriteria[];
  matchType: 'any' | 'all';
  workloadCount: number;
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
  direction: PolicyDirection;
  protocol: Protocol;
  ports?: string;
  logging: boolean;
  decrypt?: boolean;
  threatGroup?: string;
  geoGroup?: string;
  webGroupIds?: string[];
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
  gatewayPath?: string[];
}

export interface SpokeAttachment {
  id: string;
  spokeGwId: string;
  transitGwId: string;
  securityDomain?: string;
  routeAdvertisement?: string[];
}

export interface TransitPeering {
  id: string;
  transitGwId1: string;
  transitGwId2: string;
}

export interface DomainConnection {
  id: string;
  domain1Id: string;
  domain2Id: string;
  connected: boolean;
}

export interface DcfTopology {
  vpcs: Vpc[];
  gateways: Gateway[];
  securityDomains: SecurityDomain[];
  domainConnections: DomainConnection[];
  smartGroups: SmartGroup[];
  webGroups: WebGroup[];
  policies: DcfPolicy[];
  threatGroups: ThreatGroup[];
  geoGroups: GeoGroup[];
  flows: TrafficFlow[];
  spokeAttachments: SpokeAttachment[];
  transitPeerings: TransitPeering[];
}
