import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';

interface PolicyEdgeData extends Record<string, unknown> {
  action: 'allow' | 'deny';
  protocol: string;
  ports?: string;
  logging: boolean;
  decrypt?: boolean;
}

type PolicyEdgeType = Edge<PolicyEdgeData, 'policy'>;

export default memo(function PolicyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<PolicyEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isAllow = data?.action === 'allow';
  const color = isAllow ? '#10b981' : '#ef4444';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: isAllow ? undefined : '6 4',
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto cursor-pointer"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            position: 'absolute',
          }}
        >
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase border"
            style={{
              backgroundColor: color + '20',
              borderColor: color + '40',
              color,
            }}
          >
            {isAllow ? 'Allow' : 'Deny'}
            {data?.ports && (
              <span className="font-mono normal-case font-medium opacity-80">{data.protocol}/{data.ports}</span>
            )}
            {data?.logging && (
              <span className="w-1 h-1 rounded-full bg-current opacity-60" title="Logging enabled" />
            )}
            {data?.decrypt && (
              <span className="opacity-60" title="TLS Decryption">🔓</span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
