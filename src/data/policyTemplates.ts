import type { SmartGroupCriteria, PolicyAction, Protocol, ThreatGroup } from '../types/dcf';

// =============================================================================
// Policy Template — a bundle of groups + policies that can be applied in one go.
// =============================================================================
// Groups inside a template carry a `refId` rather than a real topology id; the
// template-applier resolves refIds to real group ids at apply time, reusing
// existing groups when their name already exists and creating new ones when not.
// `sg-any` and `sg-internet` may be referenced directly as refIds.

export interface PolicyTemplateSmartGroup {
  refId: string;
  name: string;
  color: string;
  criteria: SmartGroupCriteria[];
  matchType: 'any' | 'all';
}

export interface PolicyTemplateWebGroup {
  refId: string;
  name: string;
  fqdns: string[];
}

export interface PolicyTemplateThreatGroup {
  refId: string;
  name: string;
  category: ThreatGroup['category'];
  entryCount: number;
}

export interface PolicyTemplateGeoGroup {
  refId: string;
  name: string;
  countries: string[];
}

export interface PolicyTemplateEntry {
  name: string;
  priority: number;
  srcGroupRef: string;
  dstGroupRef: string;
  action: PolicyAction;
  protocol: Protocol;
  ports?: string;
  logging: boolean;
  enforcement?: boolean;
  decrypt?: boolean;
  threatGroupRef?: string;
  geoGroupRef?: string;
  webGroupRefs?: string[];
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: 'security' | 'connectivity' | 'compliance';
  smartGroups: PolicyTemplateSmartGroup[];
  webGroups?: PolicyTemplateWebGroup[];
  threatGroups?: PolicyTemplateThreatGroup[];
  geoGroups?: PolicyTemplateGeoGroup[];
  policies: PolicyTemplateEntry[];
}

// =============================================================================
// Templates
// =============================================================================

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'tpl-zero-trust-deny',
    name: 'Zero Trust Default Deny',
    description: 'Adds a catch-all deny-all policy at priority 9999. Anything not explicitly allowed by a higher-precedence rule is logged and dropped. Aviatrix Best Practice for new tenants.',
    category: 'security',
    smartGroups: [],
    policies: [
      {
        name: 'Default Deny All',
        priority: 9999,
        srcGroupRef: 'sg-any',
        dstGroupRef: 'sg-any',
        action: 'deny',
        protocol: 'any',
        logging: true,
        enforcement: true,
      },
    ],
  },

  {
    id: 'tpl-bastion',
    name: 'Bastion Access',
    description: 'Two SmartGroups (Bastion Hosts, Internal Servers) plus SSH and RDP allow-from-bastion policies with logging on. Use this when administrative access should only flow through a designated jump host.',
    category: 'connectivity',
    smartGroups: [
      {
        refId: 'bastion',
        name: 'Bastion Hosts',
        color: '#8b5cf6',
        criteria: [{ type: 'vm', key: 'role', operator: 'equals', value: 'bastion' }],
        matchType: 'any',
      },
      {
        refId: 'internal',
        name: 'Internal Servers',
        color: '#3b82f6',
        criteria: [{ type: 'vm', key: 'tier', operator: 'equals', value: 'internal' }],
        matchType: 'any',
      },
    ],
    policies: [
      {
        name: 'Bastion SSH to Internal',
        priority: 200,
        srcGroupRef: 'bastion',
        dstGroupRef: 'internal',
        action: 'allow',
        protocol: 'tcp',
        ports: '22',
        logging: true,
        enforcement: true,
      },
      {
        name: 'Bastion RDP to Internal',
        priority: 210,
        srcGroupRef: 'bastion',
        dstGroupRef: 'internal',
        action: 'allow',
        protocol: 'tcp',
        ports: '3389',
        logging: true,
        enforcement: true,
      },
    ],
  },

  {
    id: 'tpl-internet-egress-threatblock',
    name: 'Internet Egress with ThreatBlock',
    description: 'Internal SmartGroup + Malware ThreatGroup + High-Risk-Countries GeoGroup, plus an HTTPS-egress allow policy that attaches both. Aviatrix Best Practice for any internet-bound traffic flow.',
    category: 'security',
    smartGroups: [
      {
        refId: 'internal',
        name: 'Internal',
        color: '#3b82f6',
        criteria: [{ type: 'vm', key: 'tier', operator: 'equals', value: 'internal' }],
        matchType: 'any',
      },
    ],
    threatGroups: [
      {
        refId: 'malware',
        name: 'Malware Intel',
        category: 'malware',
        entryCount: 0,
      },
    ],
    geoGroups: [
      {
        refId: 'high-risk-geo',
        name: 'High-Risk Countries',
        countries: ['CN', 'RU', 'KP', 'IR'],
      },
    ],
    policies: [
      {
        name: 'Internal HTTPS Egress',
        priority: 500,
        srcGroupRef: 'internal',
        dstGroupRef: 'sg-internet',
        action: 'allow',
        protocol: 'tcp',
        ports: '443',
        logging: true,
        enforcement: true,
        decrypt: false,
        threatGroupRef: 'malware',
        geoGroupRef: 'high-risk-geo',
      },
    ],
  },

  {
    id: 'tpl-three-tier-web',
    name: 'Three-Tier Web Application',
    description: 'Web / App / DB SmartGroups with Web→App HTTPS allow, App→DB MySQL allow, and a Web→DB deny block. The classic micro-segmented stack — the deny is what makes this a real pattern, not just three allows.',
    category: 'connectivity',
    smartGroups: [
      {
        refId: 'web',
        name: 'Web Tier',
        color: '#3b82f6',
        criteria: [{ type: 'vm', key: 'app-tier', operator: 'equals', value: 'web' }],
        matchType: 'any',
      },
      {
        refId: 'app',
        name: 'App Tier',
        color: '#10b981',
        criteria: [{ type: 'vm', key: 'app-tier', operator: 'equals', value: 'app' }],
        matchType: 'any',
      },
      {
        refId: 'db',
        name: 'Database Tier',
        color: '#f59e0b',
        criteria: [{ type: 'vm', key: 'app-tier', operator: 'equals', value: 'db' }],
        matchType: 'any',
      },
    ],
    policies: [
      {
        name: 'Web to App (HTTPS)',
        priority: 100,
        srcGroupRef: 'web',
        dstGroupRef: 'app',
        action: 'allow',
        protocol: 'tcp',
        ports: '8443',
        logging: true,
        enforcement: true,
      },
      {
        name: 'App to DB (MySQL)',
        priority: 110,
        srcGroupRef: 'app',
        dstGroupRef: 'db',
        action: 'allow',
        protocol: 'tcp',
        ports: '3306',
        logging: true,
        enforcement: true,
      },
      {
        name: 'Deny Web to DB',
        priority: 120,
        srcGroupRef: 'web',
        dstGroupRef: 'db',
        action: 'deny',
        protocol: 'any',
        logging: true,
        enforcement: true,
      },
    ],
  },
];

export function getPolicyTemplate(id: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.id === id);
}
