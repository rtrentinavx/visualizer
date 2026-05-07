import { useMemo, useRef, useState, useEffect } from 'react';
import { GitGraph, PenLine, Plus, X } from 'lucide-react';
import type { DcfPolicyModel, DcfPolicy } from '../../types/dcf';

interface PolicyGraphProps {
  topology: DcfPolicyModel;
  onSelectNode: (groupId: string) => void;
  onSelectPolicy: (policyId: string) => void;
  onCreatePolicy: (srcId: string, dstId: string) => void;
  onSelectGroup: (groupId: string) => void;
}

interface NodePos {
  id: string;
  x: number;
  y: number;
  name: string;
  color: string;
  workloadCount: number;
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

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export default function PolicyGraph({ topology, onSelectNode, onSelectPolicy, onCreatePolicy, onSelectGroup }: PolicyGraphProps) {
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
    const groups = topology.smartGroups;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const r = Math.min(size.w, size.h) / 2 - 100;

    const nodeMap = new Map<string, NodePos>();
    groups.forEach((g, i) => {
      const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
      nodeMap.set(g.id, {
        id: g.id,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        name: g.name,
        color: g.color,
        workloadCount: g.workloadCount,
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
        offset: isSelfLoop ? 0 : (idx - ((pairCount.get(key) || 1) - 1) / 2) * 8,
      });
    });

    return { nodes: Array.from(nodeMap.values()), edges: edgeList };
  }, [topology, size.w, size.h]);

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  const nodeRadius = 28;

  const handleNodeClick = (nodeId: string) => {
    if (!connectMode) {
      onSelectNode(nodeId);
      return;
    }
    if (!connectSource) {
      setConnectSource(nodeId);
      return;
    }
    if (connectSource === nodeId) {
      // Cancel if clicking same node
      setConnectSource(null);
      return;
    }
    // Create policy from connectSource to nodeId
    onCreatePolicy(connectSource, nodeId);
    setConnectSource(null);
    setConnectMode(false);
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitGraph size={18} className="text-[var(--color-accent-blue)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Graph</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Click a node to edit. {connectMode ? 'Select source, then destination.' : 'Toggle Draw Policy to connect groups.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setConnectMode((v) => !v);
              setConnectSource(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              connectMode
                ? 'text-white border-transparent'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
            style={{
              backgroundColor: connectMode ? 'var(--color-aviatrix)' : 'var(--color-surface)',
              borderColor: connectMode ? 'var(--color-aviatrix)' : 'var(--color-border-subtle)',
            }}
          >
            {connectMode ? <X size={13} /> : <PenLine size={13} />}
            {connectMode ? 'Cancel' : 'Draw Policy'}
          </button>
          <div className="text-xs text-[var(--color-text-muted)]">
            {nodes.length} groups · {edges.length} policies
          </div>
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="flex-1 overflow-hidden relative" style={{ backgroundColor: 'var(--color-surface)' }}>
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
              <GitGraph size={24} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No SmartGroups yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">
              Create at least one SmartGroup to start building your policy graph.
            </p>
            <button
              onClick={() => onSelectGroup('__new__')}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Plus size={14} />
              Create SmartGroup
            </button>
          </div>
        )}
        <svg width={size.w} height={size.h} className="absolute inset-0">
          <defs>
            {/* Drop shadow filter */}
            <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
            </filter>
            <filter id="node-shadow-hover" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.5" />
            </filter>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Arrow markers */}
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
              const arcR = nodeRadius + 24;
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
                    y={e.y1 - nodeRadius - 22}
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

            const dx = e.x2 - e.x1;
            const dy = e.y2 - e.y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            const nx = -dy / len;
            const ny = dx / len;
            const offX = nx * e.offset;
            const offY = ny * e.offset;

            const shorten = nodeRadius + 10;
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
            const isConnectSource = connectSource === n.id;
            const isRelatedToHoveredEdge = hoveredEdge && edges.some((e) => e.policy.id === hoveredEdge && (e.policy.srcGroupId === n.id || e.policy.dstGroupId === n.id));
            const dim = hoveredEdge && !isRelatedToHoveredEdge && !isHovered;
            const isSelectableDest = connectMode && connectSource && connectSource !== n.id;

            return (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                onClick={() => handleNodeClick(n.id)}
                onMouseEnter={() => setHoveredNode(n.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
                opacity={dim ? 0.3 : 1}
                style={{ transition: 'opacity 0.2s' }}
              >
                {/* Outer glow ring for connect source */}
                {isConnectSource && (
                  <circle r={nodeRadius + 6} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 2" opacity="0.8">
                    <animate attributeName="r" values={`${nodeRadius + 4};${nodeRadius + 8};${nodeRadius + 4}`} dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Hover ring */}
                {isHovered && !isConnectSource && (
                  <circle r={nodeRadius + 4} fill="none" stroke="var(--color-text-muted)" strokeWidth="1" opacity="0.5" />
                )}

                {/* Dest highlight in connect mode */}
                {isSelectableDest && (
                  <circle r={nodeRadius + 4} fill="none" stroke="#22c55e" strokeWidth="2" strokeDasharray="3 3" opacity="0.6" />
                )}

                {/* Main node circle with shadow */}
                <circle
                  r={nodeRadius}
                  fill={n.color}
                  stroke={isConnectSource ? '#3b82f6' : isHovered ? 'var(--color-text-primary)' : 'rgba(255,255,255,0.15)'}
                  strokeWidth={isConnectSource ? 3 : 2}
                  filter={isHovered ? 'url(#node-shadow-hover)' : 'url(#node-shadow)'}
                  style={{ transition: 'all 0.2s' }}
                />

                {/* Inner white circle with initial */}
                <circle r={nodeRadius * 0.45} fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <text
                  y={1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="14"
                  fontWeight="700"
                  style={{ pointerEvents: 'none' }}
                >
                  {getInitial(n.name)}
                </text>

                {/* Label */}
                <text
                  y={nodeRadius + 18}
                  textAnchor="middle"
                  fill="var(--color-text-secondary)"
                  fontSize="12"
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
