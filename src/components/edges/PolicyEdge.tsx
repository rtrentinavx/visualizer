import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from '@xyflow/react';
import { ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import type { PolicyDirection } from '../../types/dcf';

interface PolicyEdgeData extends Record<string, unknown> {
  action: 'allow' | 'deny' | 'learned';
  protocol: string;
  ports?: string;
  logging: boolean;
  decrypt?: boolean;
  direction?: PolicyDirection;
  webGroupIds?: string[];
  srcExcludeGroupIds?: string[];
  dstExcludeGroupIds?: string[];
}

type PolicyEdgeType = Edge<PolicyEdgeData, 'policy'>;

function DirectionIcon({ dir }: { dir?: PolicyDirection }) {
  if (dir === 'inbound') return <ArrowLeft size={10} />;
  if (dir === 'outbound') return <ArrowRight size={10} />;
  return <ArrowLeftRight size={10} />;
}

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
  const isLearned = data?.action === 'learned';
  const color = isAllow ? '#10b981' : isLearned ? '#6366f1' : '#ef4444';

  const hasExclusions =
    (data?.srcExcludeGroupIds && data.srcExcludeGroupIds.length > 0) ||
    (data?.dstExcludeGroupIds && data.dstExcludeGroupIds.length > 0);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: data?.action === 'deny' ? '6 4' : undefined,
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
            <DirectionIcon dir={data?.direction} />
            {isAllow ? 'Allow' : isLearned ? 'LEARNED' : 'Deny'}
            {data?.ports && (
              <span className="font-mono normal-case font-medium opacity-80">{data.protocol}/{data.ports}</span>
            )}
            {data?.logging && (
              <span className="w-1 h-1 rounded-full bg-current opacity-60" title="Logging enabled" />
            )}
            {data?.decrypt && (
              <span className="opacity-60" title="TLS Decryption">🔓</span>
            )}
            {data?.webGroupIds && data.webGroupIds.length > 0 && (
              <span className="ml-0.5 px-1 rounded bg-current/20 text-[9px] font-bold" title={`Web Groups: ${data.webGroupIds.join(', ')}`}>WG</span>
            )}
            {hasExclusions && (
              <span className="opacity-80" title="Exclusions applied">¬</span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
