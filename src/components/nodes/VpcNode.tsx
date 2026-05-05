import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Network } from 'lucide-react';

interface VpcNodeData extends Record<string, unknown> {
  name: string;
  cidr: string;
  account: string;
}

type VpcNode = Node<VpcNodeData, 'vpc'>;

export default memo(function VpcNode({ data }: NodeProps<VpcNode>) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-3 py-2 min-w-[140px]">
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 mb-1">
        <Network size={14} className="text-[var(--color-accent-blue)]" />
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase">VPC / VNet</span>
      </div>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{data.name}</div>
      <div className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">{data.cidr}</div>
      <div className="text-[10px] text-[var(--color-text-muted)] mt-1">{data.account}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});
