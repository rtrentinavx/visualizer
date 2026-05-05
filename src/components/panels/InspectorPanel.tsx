import { X, Shield, Globe, Tag, Boxes, Router, Filter, Network, Server, Cloud } from 'lucide-react';
import type { DcfTopology, GatewayType } from '../../types/dcf';

interface InspectorPanelProps {
  topology: DcfTopology;
  selectedNodeId: string | null;
  selectedNodeType: string | null;
  onClose: () => void;
}

const gatewayIcons: Record<GatewayType, typeof Shield> = {
  transit: Router,
  spoke: Server,
  dcf: Filter,
  egress: Globe,
  edge: Shield,
};

export default function InspectorPanel({ topology, selectedNodeId, selectedNodeType, onClose }: InspectorPanelProps) {
  if (!selectedNodeId || !selectedNodeType) {
    return (
      <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
        <div className="p-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="text-[var(--color-text-muted)] text-sm">
            Select a node on the canvas to view details
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (selectedNodeType) {
      case 'cloudRegion': {
        const region = topology.regions.find((r) => r.id === selectedNodeId);
        if (!region) return null;
        return (
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Region</div>
              <div className="text-lg font-medium text-[var(--color-text-primary)]">{region.name}</div>
            </div>
            <div className="flex items-center gap-2">
              <Cloud size={16} className="text-[var(--color-accent-blue)]" />
              <span className="text-sm text-[var(--color-text-secondary)] capitalize">{region.provider}</span>
            </div>
            {region.cidr && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">CIDR</div>
                <code className="text-xs bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text-primary)]">{region.cidr}</code>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">VPCs in Region</div>
              <div className="space-y-1.5">
                {topology.vpcs
                  .filter((v) => v.regionId === region.id)
                  .map((vpc) => (
                    <div key={vpc.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                      <div className="flex items-center gap-2">
                        <Network size={12} className="text-[var(--color-accent-blue)]" />
                        <span className="text-xs text-[var(--color-text-primary)]">{vpc.name}</span>
                      </div>
                      <code className="text-[10px] text-[var(--color-text-muted)]">{vpc.cidr}</code>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        );
      }
      case 'vpc': {
        const vpc = topology.vpcs.find((v) => v.id === selectedNodeId);
        if (!vpc) return null;
        const region = topology.regions.find((r) => r.id === vpc.regionId);
        const gateways = topology.gateways.filter((g) => g.vpcId === vpc.id);
        return (
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">VPC / VNet</div>
              <div className="text-lg font-medium text-[var(--color-text-primary)]">{vpc.name}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Region</div>
                <div className="text-xs text-[var(--color-text-primary)] mt-0.5">{region?.name}</div>
              </div>
              <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Account</div>
                <div className="text-xs text-[var(--color-text-primary)] mt-0.5">{vpc.account}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">CIDR</div>
              <code className="text-xs bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text-primary)]">{vpc.cidr}</code>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Gateways</div>
              <div className="space-y-1.5">
                {gateways.map((gw) => {
                  const Icon = gatewayIcons[gw.type];
                  return (
                    <div key={gw.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                      <div className="flex items-center gap-2">
                        <Icon size={12} className="text-[var(--color-accent-blue)]" />
                        <span className="text-xs text-[var(--color-text-primary)]">{gw.name}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${gw.haEnabled ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {gw.haEnabled ? 'HA' : 'Single'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }
      case 'gateway': {
        const gw = topology.gateways.find((g) => g.id === selectedNodeId);
        if (!gw) return null;
        const vpc = topology.vpcs.find((v) => v.id === gw.vpcId);
        const Icon = gatewayIcons[gw.type];
        return (
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Gateway</div>
              <div className="text-lg font-medium text-[var(--color-text-primary)]">{gw.name}</div>
            </div>
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-[var(--color-accent-blue)]" />
              <span className="text-sm text-[var(--color-text-secondary)] capitalize">{gw.type} Gateway</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                <div className="text-[10px] text-[var(--color-text-muted)] uppercase">VPC</div>
                <div className="text-xs text-[var(--color-text-primary)] mt-0.5">{vpc?.name}</div>
              </div>
              <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                <div className="text-[10px] text-[var(--color-text-muted)] uppercase">HA Status</div>
                <div className={`text-xs mt-0.5 ${gw.haEnabled ? 'text-green-400' : 'text-amber-400'}`}>{gw.haEnabled ? 'Enabled' : 'Disabled'}</div>
              </div>
            </div>
            {gw.ip && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">IP Address</div>
                <code className="text-xs bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text-primary)]">{gw.ip}</code>
              </div>
            )}
          </div>
        );
      }
      case 'smartGroup': {
        const sg = topology.smartGroups.find((s) => s.id === selectedNodeId);
        if (!sg) return null;
        const relatedPolicies = topology.policies.filter((p) => p.srcGroupId === sg.id || p.dstGroupId === sg.id);
        const relatedVpcs = topology.vpcs.filter((v) => sg.vpcIds.includes(v.id));
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Boxes size={18} style={{ color: sg.color }} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">SmartGroup</div>
                <div className="text-lg font-medium text-[var(--color-text-primary)]">{sg.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: sg.color + '15', border: `1px solid ${sg.color}30` }}>
              <span className="text-2xl font-bold" style={{ color: sg.color }}>{sg.workloadCount}</span>
              <span className="text-xs text-[var(--color-text-secondary)]">workloads match this group</span>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Match Criteria</div>
              <div className="flex flex-wrap gap-1.5">
                {sg.criteria.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium" style={{ backgroundColor: sg.color + '20', color: sg.color }}>
                    <Tag size={10} />
                    {c.key} = {c.value}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Present In VPCs</div>
              <div className="flex flex-wrap gap-1.5">
                {relatedVpcs.map((v) => (
                  <span key={v.id} className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                    {v.name}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Related Policies ({relatedPolicies.length})</div>
              <div className="space-y-1.5">
                {relatedPolicies.map((p) => (
                  <div key={p.id} className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-primary)]">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.action === 'allow' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {p.action}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {p.protocol.toUpperCase()} {p.ports && `:${p.ports}`} • Priority {p.priority}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>
    </div>
  );
}
