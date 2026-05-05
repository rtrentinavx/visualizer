import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Boxes, Tag } from 'lucide-react';

interface SmartGroupNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  criteria: { key: string; value: string }[];
  workloadCount: number;
}

type SmartGroupNode = Node<SmartGroupNodeData, 'smartGroup'>;

export default memo(function SmartGroupNode({ data }: NodeProps<SmartGroupNode>) {
  return (
    <div
      className="rounded-lg border bg-[var(--color-surface-raised)] px-3 py-2 min-w-[150px]"
      style={{ borderColor: data.color + '60' }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 mb-1">
        <Boxes size={14} style={{ color: data.color }} />
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: data.color }}>
          SmartGroup
        </span>
      </div>
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{data.name}</div>
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {data.criteria.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: data.color + '20', color: data.color }}
          >
            <Tag size={8} />
            {c.key}={c.value}
          </span>
        ))}
      </div>
      <div className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
        {data.workloadCount} workload{data.workloadCount !== 1 ? 's' : ''}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
