import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Cloud } from 'lucide-react';
import type { CloudProvider } from '../../types/dcf';

const providerColors: Record<CloudProvider, string> = {
  aws: '#FF9900',
  azure: '#0078D4',
  gcp: '#4285F4',
  oci: '#F80000',
};

const providerLabels: Record<CloudProvider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  oci: 'OCI',
};

interface CloudRegionNodeData extends Record<string, unknown> {
  name: string;
  provider: CloudProvider;
  cidr?: string;
}

type CloudRegionNode = Node<CloudRegionNodeData, 'cloudRegion'>;

export default memo(function CloudRegionNode({ data }: NodeProps<CloudRegionNode>) {
  const color = providerColors[data.provider];
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-4 py-3 min-w-[180px]">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex items-center gap-2 mb-1">
        <Cloud size={16} style={{ color }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
          {providerLabels[data.provider]}
        </span>
      </div>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{data.name}</div>
      {data.cidr && (
        <div className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">{data.cidr}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </div>
  );
});
