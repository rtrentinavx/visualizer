import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Shield, Router, Globe, Server } from 'lucide-react';
import type { GatewayType } from '../../types/dcf';

const gatewayConfig: Record<GatewayType, { icon: typeof Shield; label: string; color: string }> = {
  transit: { icon: Router, label: 'Transit GW', color: '#3b82f6' },
  spoke: { icon: Server, label: 'Spoke GW', color: '#06b6d4' },
  egress: { icon: Globe, label: 'Egress GW', color: '#f59e0b' },
  edge: { icon: Shield, label: 'Edge GW', color: '#8b5cf6' },
};

interface GatewayNodeData extends Record<string, unknown> {
  name: string;
  type: GatewayType;
  haEnabled: boolean;
  ip?: string;
}

type GatewayNode = Node<GatewayNodeData, 'gateway'>;

export default memo(function GatewayNode({ data }: NodeProps<GatewayNode>) {
  const config = gatewayConfig[data.type];
  const Icon = config.icon;
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 min-w-[130px]">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color: config.color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{data.name}</div>
      {data.ip && <div className="text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">{data.ip}</div>}
      <div className="flex items-center gap-1 mt-1">
        <div className={`w-1.5 h-1.5 rounded-full ${data.haEnabled ? 'bg-green-500' : 'bg-amber-500'}`} />
        <span className="text-[10px] text-[var(--color-text-muted)]">{data.haEnabled ? 'HA Active' : 'Single'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
