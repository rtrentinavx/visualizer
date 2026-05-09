import { useState } from 'react';
import { X, BookOpen, ShieldAlert, AlertTriangle, Info, Search } from 'lucide-react';
import type { Framework, FindingCategory } from '../../lib/policyEvaluator';

interface Practice {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: FindingCategory;
  frameworks: Framework[];
  title: string;
  description: string;
  why: string;
}

const PRACTICES: Practice[] = [
  {
    id: 'missing-deny-all',
    severity: 'error',
    category: 'security',
    frameworks: ['Aviatrix BP', 'NIST ZT', 'CIS'],
    title: 'Missing Catch-All Deny',
    description: 'No deny-all policy found. Set the Post Rules Policy List to block all non-defined items.',
    why: 'Without a default deny, unmatched traffic may be implicitly allowed. CIS Control 4.4 and NIST Zero Trust both require explicit deny-by-default posture.',
  },
  {
    id: 'overly-permissive',
    severity: 'error',
    category: 'security',
    frameworks: ['NIST ZT', 'CIS', 'Aviatrix BP'],
    title: 'Overly Permissive Policy',
    description: 'Policy allows all traffic (any → any). Narrow source/destination to specific SmartGroups.',
    why: 'NIST SP 800-207 (Zero Trust) principle: never trust, always verify. Any→any allow violates least privilege. CIS recommends segmenting networks by function.',
  },
  {
    id: 'shadowed-policy',
    severity: 'warning',
    category: 'performance',
    frameworks: ['Aviatrix BP', 'Best Practice'],
    title: 'Shadowed Policy',
    description: 'A lower-priority policy is completely covered by a higher-priority one and will never be evaluated.',
    why: 'Aviatrix DCF uses first-enforced-match ordering. Dead rules create confusion during audits and upgrades.',
  },
  {
    id: 'conflicting-actions',
    severity: 'warning',
    category: 'security',
    frameworks: ['Aviatrix BP', 'Best Practice'],
    title: 'Conflicting Actions',
    description: 'Multiple policies between the same src/dst/proto/port have different actions.',
    why: 'While DCF resolves conflicts via priority, having both allow and deny for the same flow makes the policy model hard to reason about and error-prone during changes.',
  },
  {
    id: 'deny-no-logging',
    severity: 'warning',
    category: 'compliance',
    frameworks: ['Aviatrix BP', 'CIS', 'NIST ZT'],
    title: 'Deny Policy Without Logging',
    description: 'A deny rule has logging disabled. Security events are invisible.',
    why: 'CIS Control 8.2: Collect audit logs. NIST SP 800-53 AU-6: Audit review. You cannot detect or investigate attacks on denied traffic without logs.',
  },
  {
    id: 'allow-no-logging',
    severity: 'info',
    category: 'compliance',
    frameworks: ['CIS', 'NIST ZT', 'Best Practice'],
    title: 'Allow Policy Without Logging',
    description: 'An allow rule has logging disabled. Traffic patterns cannot be analyzed.',
    why: 'Best practice: log all policy hits for CoPilot traffic analysis, SIEM correlation, and compliance reporting.',
  },
  {
    id: 'duplicate-priority',
    severity: 'warning',
    category: 'naming',
    frameworks: ['Aviatrix BP', 'Best Practice'],
    title: 'Duplicate Priority',
    description: 'Multiple policies share the same priority value.',
    why: 'Aviatrix evaluates rules in priority order. Duplicates create non-deterministic enforcement when flows match both rules.',
  },
  {
    id: 'duplicate-name',
    severity: 'warning',
    category: 'naming',
    frameworks: ['Best Practice', 'Aviatrix BP'],
    title: 'Duplicate Policy Name',
    description: 'Multiple policies share the same display name.',
    why: 'Unique names prevent upgrade failures, Terraform state conflicts, and make audits and runbooks easier to follow.',
  },
  {
    id: 'webgroup-not-internet',
    severity: 'error',
    category: 'compliance',
    frameworks: ['Aviatrix BP'],
    title: 'WebGroup Rule Must Target Internet',
    description: 'A policy uses WebGroups but the destination is not "Internet".',
    why: 'Aviatrix DCF architecture: WebGroups are FQDN filters applied to public internet egress. Targeting internal groups with WebGroups is unsupported.',
  },
  {
    id: 'tls-decrypt-port',
    severity: 'warning',
    category: 'compliance',
    frameworks: ['Aviatrix BP', 'Best Practice'],
    title: 'TLS Decryption Should Target Port 443',
    description: 'TLS Decryption is enabled but the policy does not target port 443.',
    why: 'TLS decryption in Aviatrix only inspects HTTPS traffic. Port 443 is the standard HTTPS port; other ports will not be inspected even with decrypt=true.',
  },
  {
    id: 'tls-decrypt-protocol',
    severity: 'error',
    category: 'compliance',
    frameworks: ['Aviatrix BP'],
    title: 'TLS Decryption Requires TCP Protocol',
    description: 'TLS Decryption is enabled with a non-TCP protocol.',
    why: 'TLS is a TCP-layer protocol. Setting decrypt=true on UDP or ICMP has no effect and signals a configuration misunderstanding.',
  },
  {
    id: 'broad-allow',
    severity: 'warning',
    category: 'security',
    frameworks: ['CIS', 'NIST ZT', 'Best Practice'],
    title: 'Overly Broad Allow Rule',
    description: 'Policy allows any protocol on any port without WebGroup filtering.',
    why: 'CIS Control 4.4: Implement firewalls with deny-by-default rules. NIST Zero Trust: enforce least privilege at the port and protocol level.',
  },
  {
    id: 'high-priority-broad',
    severity: 'warning',
    category: 'security',
    frameworks: ['NIST ZT', 'Best Practice'],
    title: 'High-Priority Broad Rule',
    description: 'A very high-priority (≤50) any→any rule exists.',
    why: 'High-priority catch-all rules shadow more specific rules below them. NIST Zero Trust recommends specific rules first, catch-all last.',
  },
  {
    id: 'internet-no-threat-geo',
    severity: 'info',
    category: 'security',
    frameworks: ['Aviatrix BP', 'NIST ZT'],
    title: 'Internet Policy Lacks Threat/Geo Filtering',
    description: 'An internet-facing allow rule has no ThreatGroup or GeoGroup attached.',
    why: 'Aviatrix Best Practice: layer threat intelligence (botnet, malware, phishing IPs) and geo-restrictions on all internet egress. NIST ZT: continuous verification.',
  },
  {
    id: 'https-no-inspection',
    severity: 'info',
    category: 'security',
    frameworks: ['NIST ZT', 'CIS', 'Aviatrix BP'],
    title: 'HTTPS Egress Without TLS Inspection',
    description: 'An internet HTTPS allow rule does not have TLS decryption enabled.',
    why: 'NIST SP 800-207: inspect encrypted traffic to prevent data exfiltration and C2 callbacks. CIS Control 13.10: implement TLS inspection.',
  },
  {
    id: 'learned-no-deny',
    severity: 'warning',
    category: 'security',
    frameworks: ['Aviatrix BP', 'NIST ZT'],
    title: 'Learned Rules Without Deny-All',
    description: 'Learned-mode policies exist but there is no catch-all deny.',
    why: 'Learned policies discover traffic patterns during a monitoring phase. Without a Post Rules deny-all, undefined traffic is not blocked when you switch to enforcement.',
  },
  {
    id: 'unused-smartgroup',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice'],
    title: 'Unused SmartGroup',
    description: 'A SmartGroup is defined but not referenced by any policy.',
    why: 'Stale groups clutter the topology, slow down the controller, and create confusion during audits.',
  },
  {
    id: 'unused-webgroup',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice'],
    title: 'Unused WebGroup',
    description: 'A WebGroup is defined but not attached to any policy.',
    why: 'Unused FQDN lists consume controller memory and make policy reviews harder.',
  },
  {
    id: 'unused-threatgroup',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice'],
    title: 'Unused ThreatGroup',
    description: 'A ThreatGroup is defined but not referenced by any policy.',
    why: 'Threat intelligence feeds are only valuable when applied to traffic. Attach them to internet-facing allow rules.',
  },
  {
    id: 'unused-geogroup',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice'],
    title: 'Unused GeoGroup',
    description: 'A GeoGroup is defined but not referenced by any policy.',
    why: 'Geo-restrictions only take effect when attached to policies. Unused groups are dead weight.',
  },
  {
    id: 'self-to-self',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice'],
    title: 'Self-to-Self Policy',
    description: 'A policy has the same source and destination SmartGroup.',
    why: 'DCF is designed for inter-group (east-west) traffic. Intra-group traffic is usually handled by workload-level firewalls or host policies, not DCF.',
  },
  {
    id: 'enforcement-off',
    severity: 'info',
    category: 'hygiene',
    frameworks: ['Best Practice', 'Aviatrix BP'],
    title: 'Policy Enforcement Disabled',
    description: 'A policy has enforcement turned off (monitor mode).',
    why: 'Monitor mode is great for testing, but forgotten monitor-mode rules create gaps in your security posture. Review regularly.',
  },
];

const severityConfig = {
  error: { icon: ShieldAlert, color: '#ef4444', label: 'Error' },
  warning: { icon: AlertTriangle, color: '#f59e0b', label: 'Warning' },
  info: { icon: Info, color: '#3b82f6', label: 'Info' },
};

const categoryLabel: Record<FindingCategory, string> = {
  security: 'Security',
  naming: 'Naming',
  performance: 'Performance',
  compliance: 'Compliance',
  hygiene: 'Hygiene',
};

const frameworkColors: Record<Framework, string> = {
  'Aviatrix BP': '#10b981',
  'CIS': '#f59e0b',
  'NIST ZT': '#3b82f6',
  'Best Practice': '#8b5cf6',
};

export default function BestPracticesModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<FindingCategory | 'all'>('all');
  const [activeFramework, setActiveFramework] = useState<Framework | 'all'>('all');

  const frameworks: Framework[] = ['Aviatrix BP', 'CIS', 'NIST ZT', 'Best Practice'];
  const categories: FindingCategory[] = ['security', 'naming', 'performance', 'compliance', 'hygiene'];

  const filtered = PRACTICES.filter((p) => {
    const matchesSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.why.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
    const matchesFramework = activeFramework === 'all' || p.frameworks.includes(activeFramework);
    return matchesSearch && matchesCategory && matchesFramework;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <BookOpen size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Best Practices Reference</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">21 checks aligned to Aviatrix, CIS, and NIST Zero Trust</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="px-4 pt-4 pb-2 space-y-3 border-b border-[var(--color-border-subtle)]">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search practices..."
              className="w-full pl-8 pr-3 py-1.5 rounded text-xs border outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory('all')}
              className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border"
              style={{
                backgroundColor: activeCategory === 'all' ? 'var(--color-accent-blue)' : 'var(--color-surface)',
                color: activeCategory === 'all' ? '#fff' : 'var(--color-text-muted)',
                borderColor: 'var(--color-border-subtle)',
              }}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? 'all' : cat)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border"
                style={{
                  backgroundColor: activeCategory === cat ? 'var(--color-accent-blue)' : 'var(--color-surface)',
                  color: activeCategory === cat ? '#fff' : 'var(--color-text-muted)',
                  borderColor: 'var(--color-border-subtle)',
                }}
              >
                {categoryLabel[cat]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveFramework('all')}
              className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border"
              style={{
                backgroundColor: activeFramework === 'all' ? 'var(--color-text-muted)' : 'var(--color-surface)',
                color: activeFramework === 'all' ? '#fff' : 'var(--color-text-muted)',
                borderColor: 'var(--color-border-subtle)',
              }}
            >
              All Frameworks
            </button>
            {frameworks.map((fw) => (
              <button
                key={fw}
                onClick={() => setActiveFramework(activeFramework === fw ? 'all' : fw)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border"
                style={{
                  backgroundColor: activeFramework === fw ? frameworkColors[fw] : frameworkColors[fw] + '12',
                  color: activeFramework === fw ? '#fff' : frameworkColors[fw],
                  borderColor: frameworkColors[fw] + '40',
                }}
              >
                {fw}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
              No practices match your filters.
            </div>
          ) : (
            filtered.map((p) => {
              const config = severityConfig[p.severity];
              const Icon = config.icon;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border p-3"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
                >
                  <div className="grid grid-cols-[auto_1fr] gap-3">
                    <div className="shrink-0 w-4 flex justify-center pt-0.5">
                      <Icon size={16} style={{ color: config.color }} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider leading-none px-1 py-0.5 rounded" style={{ color: config.color, backgroundColor: config.color + '12' }}>
                          {config.label}
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded leading-none" style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}>
                          {categoryLabel[p.category]}
                        </span>
                        {p.frameworks.map((fw) => (
                          <span
                            key={fw}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none"
                            style={{ backgroundColor: frameworkColors[fw] + '15', color: frameworkColors[fw] }}
                          >
                            {fw}
                          </span>
                        ))}
                      </div>
                      <span className="text-sm font-medium text-[var(--color-text-primary)] leading-snug">{p.title}</span>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{p.description}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed border-l-2 pl-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <span className="font-semibold">Why it matters:</span> {p.why}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
