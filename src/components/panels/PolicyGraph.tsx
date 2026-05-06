import { useMemo, useRef, useState, useEffect } from 'react';
import type { DcfPolicyModel, DcfPolicy } from '../../types/dcf';

interface PolicyGraphProps {
  topology: DcfPolicyModel;
  onSelectNode: (groupId: string) => void;
  onSelectPolicy: (policyId: string) => void;
}

interface NodePos {
  id: string;
  x: number;
  y: number;
  name: string;
  color: string;
}

interface EdgePos {
  policy: DcfPolicy;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  isSelfLoop: boolean;
  offset: number;
}

function getActionColor(action: string): string {
  if (action === 'allow') return '#22c55e';
  if (action === 'learned') return '#8b5cf6';
  return '#ef4444';
}

export default function PolicyGraph({ topology, onSelectNode, onSelectPolicy }: PolicyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = useMemo(() => {
    const groups = topology.smartGroups.filter((g) => g.id !== 'sg-internet');
    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.min(size.w, size.h) / 2 - 80;

    const nodeMap = new Map<string, NodePos>();
    groups.forEach((g, i) => {
      const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
      nodeMap.set(g.id, {
        id: g.id,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        name: g.name,
        color: g.color,
      });
    });

    // Count edges per node pair for parallel offset
    const pairCount = new Map<string, number>();
    topology.policies.forEach((p) => {
      const key = p.srcGroupId <= p.dstGroupId ? `${p.srcGroupId}|${p.dstGroupId}` : `${p.dstGroupId}|${p.srcGroupId}`;
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    });
    const pairIndex = new Map<string, number>();

    const edgeList: EdgePos[] = [];
    topology.policies.forEach((p) => {
      const src = nodeMap.get(p.srcGroupId);
      const dst = nodeMap.get(p.dstGroupId);
      if (!src || !dst) return;

      const isSelfLoop = p.srcGroupId === p.dstGroupId;
      const key = p.srcGroupId <= p.dstGroupId ? `${p.srcGroupId}|${p.dstGroupId}` : `${p.dstGroupId}|${p.srcGroupId}`;
      const idx = pairIndex.get(key) || 0;
      pairIndex.set(key, idx + 1);

      edgeList.push({
        policy: p,
        x1: src.x,
        y1: src.y,
        x2: dst.x,
        y2: dst.y,
        label: `${p.priority}`,
        isSelfLoop,
        offset: isSelfLoop ? 0 : (idx - ((pairCount.get(key) || 1) - 1) / 2) * 6,
      });
    });

    return { nodes: Array.from(nodeMap.values()), edges: edgeList };
  }, [topology, size.w, size.h]);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const nodeRadius = 24;

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Graph</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            SmartGroups as nodes, policies as edges
          </p>
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          {nodes.length} groups · {edges.length} policies
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative" style={{ backgroundColor: 'var(--color-surface)' }}>
        <svg width={size.w} height={size.h} className="absolute inset-0">
          <defs>
            <marker id="arrow-allow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#22c55e" />
            </marker>
            <marker id="arrow-learned" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#8b5cf6" />
            </marker>
            <marker id="arrow-deny" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#ef4444" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((e) => {
            const color = getActionColor(e.policy.action);
            const isHovered = hoveredEdge === e.policy.id;
            const isRelatedToHoveredNode = hoveredNode && (e.policy.srcGroupId === hoveredNode || e.policy.dstGroupId === hoveredNode);
            const dim = hoveredNode && !isRelatedToHoveredNode && !isHovered;

            if (e.isSelfLoop) {
              // Self loop arc
              const arcR = nodeRadius + 20;
              return (
                <g
                  key={e.policy.id}
                  onClick={() => onSelectPolicy(e.policy.id)}
                  onMouseEnter={() => setHoveredEdge(e.policy.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  className="cursor-pointer"
                  opacity={dim ? 0.15 : isHovered ? 1 : 0.7}
                >
                  <path
                    d={`M ${e.x1 - nodeRadius * 0.7} ${e.y1 - nodeRadius * 0.7} Q ${e.x1 - arcR * 1.5} ${e.y1 - arcR * 1.5} ${e.x1 + nodeRadius * 0.7} ${e.y1 - nodeRadius * 0.7}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? 3 : 2}
                    markerEnd={`url(#arrow-${e.policy.action})`}
                  />
                  <text
                    x={e.x1}
                    y={e.y1 - nodeRadius - 18}
                    textAnchor="middle"
                    fill={isHovered ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {e.label}
                  </text>
                </g>
              );
            }

            // Offset parallel edges
            const dx = e.x2 - e.x1;
            const dy = e.y2 - e.y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const nx = -dy / len;
            const ny = dx / len;
            const offX = nx * e.offset;
            const offY = ny * e.offset;

            // Shorten line so arrow doesn't overlap node
            const shorten = nodeRadius + 8;
            const ratio = (len - shorten) / len;
            const sx1 = e.x1 + offX;
            const sy1 = e.y1 + offY;
            const sx2 = e.x1 + dx * ratio + offX;
            const sy2 = e.y1 + dy * ratio + offY;

            const mx = (sx1 + sx2) / 2;
            const my = (sy1 + sy2) / 2;

            return (
              <g
                key={e.policy.id}
                onClick={() => onSelectPolicy(e.policy.id)}
                onMouseEnter={() => setHoveredEdge(e.policy.id)}
                onMouseLeave={() => setHoveredEdge(null)}
                className="cursor-pointer"
                opacity={dim ? 0.15 : isHovered ? 1 : 0.6}
              >
                <line
                  x1={sx1}
                  y1={sy1}
                  x2={sx2}
                  y2={sy2}
                  stroke={color}
                  strokeWidth={isHovered ? 3 : 1.5}
                  markerEnd={`url(#arrow-${e.policy.action})`}
                />
                <text
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  fill={isHovered ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}
                  fontSize="9"
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {e.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((n) => {
            const isHovered = hoveredNode === n.id;
            const isRelatedToHoveredEdge = hoveredEdge && edges.some((e) => e.policy.id === hoveredEdge && (e.policy.srcGroupId === n.id || e.policy.dstGroupId === n.id));
            const dim = hoveredEdge && !isRelatedToHoveredEdge && !isHovered;

            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                onClick={() => onSelectNode(n.id)}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
                opacity={dim ? 0.3 : 1}
              >
                <circle
                  r={nodeRadius}
                  fill={n.color}
                  stroke={isHovered ? 'var(--color-text-primary)' : 'var(--color-surface-raised)'}
                  strokeWidth={isHovered ? 3 : 2}
                  style={{ transition: 'all 0.15s' }}
                />
                <text
                  y={nodeRadius + 14}
                  textAnchor="middle"
                  fill="var(--color-text-secondary)"
                  fontSize="11"
                  fontWeight="500"
                  style={{ pointerEvents: 'none' }}
                >
                  {n.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-green-400" />
            <span>Allow</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[var(--color-accent-purple)]" />
            <span>Learned</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-red-400" />
            <span>Deny</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono">#</span>
            <span>Priority</span>
          </div>
        </div>
      </div>
    </div>
  );
}
