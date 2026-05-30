import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  ReactFlowProvider,
  BaseEdge,
  getStraightPath,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  BackgroundVariant,
} from '@xyflow/react';
import { Plus } from 'lucide-react';
import type { DcfPolicyModel, SmartGroup } from '../../types/dcf';
import GroupNode, { type GroupNodeData } from '../graph/GroupNode';
import GraphToolbar, { type GraphState } from '../graph/GraphToolbar';
import { groupPoliciesIntoEdges, type GroupedEdge } from '../graph/edgeUtils';
import { assignZone, getZoneBandY, ZONE_ORDER } from '../graph/zoneUtils';

// ---------------------------------------------------------------------------
// Props — preserved exactly as App.tsx passes them
// ---------------------------------------------------------------------------

interface PolicyGraphProps {
  topology: DcfPolicyModel;
  onSelectNode: (groupId: string) => void;
  onSelectPolicy: (policyId: string) => void;
  onCreatePolicy: (srcId: string, dstId: string) => void;
  onSelectGroup: (groupId: string) => void;
}

// ---------------------------------------------------------------------------
// Custom edge — wide invisible hit zone so thin lines are easy to click
// ---------------------------------------------------------------------------

function PolicyEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius }: EdgeProps) {
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      {/* invisible wide hit zone */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={16} />
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_W = 160;
const NODE_H = 56;
const CANVAS_HEIGHT = 600;
const X_PADDING = 80;

const SPECIAL_INTERNET: SmartGroup = {
  id: 'sg-internet',
  name: 'Internet',
  color: '#64748b',
  criteria: [],
  matchType: 'any',
};

const SPECIAL_ANY: SmartGroup = {
  id: 'sg-any',
  name: 'Any (wildcard)',
  color: '#8b5cf6',
  criteria: [],
  matchType: 'any',
};

const NODE_TYPES = { groupNode: GroupNode };
const EDGE_TYPES = { policy: PolicyEdge };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgeColor(effectiveAction: GroupedEdge['effectiveAction']): string {
  if (effectiveAction === 'allow') return '#22c55e';
  if (effectiveAction === 'deny') return '#ef4444';
  if (effectiveAction === 'mixed') return '#a855f7';
  // learned
  return '#f59e0b';
}

function buildReactFlowNodes(
  allGroups: SmartGroup[],
  groupedEdges: GroupedEdge[],
  isolatedNodeId: string | null,
  showPostureMode: boolean,
  canvasWidth: number,
): Node<GroupNodeData>[] {
  // Build per-zone buckets for x distribution
  const byZone = new Map<string, SmartGroup[]>();
  for (const zone of ZONE_ORDER) byZone.set(zone, []);
  for (const g of allGroups) {
    const zone = assignZone(g);
    byZone.get(zone)!.push(g);
  }

  // Count inbound / outbound per group
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const ge of groupedEdges) {
    inbound.set(ge.target, (inbound.get(ge.target) ?? 0) + ge.policies.length);
    outbound.set(ge.source, (outbound.get(ge.source) ?? 0) + ge.policies.length);
  }

  const nodes: Node<GroupNodeData>[] = [];

  for (const zone of ZONE_ORDER) {
    const members = byZone.get(zone) ?? [];
    if (members.length === 0) continue;
    const bandY = getZoneBandY(zone, CANVAS_HEIGHT) - NODE_H / 2;

    // Distribute evenly across canvas width
    const totalSpacing = canvasWidth - X_PADDING * 2;
    const step = members.length > 1 ? totalSpacing / (members.length - 1) : 0;
    const startX = members.length === 1 ? canvasWidth / 2 - NODE_W / 2 : X_PADDING;

    members.forEach((g, idx) => {
      const x = startX + idx * step - (members.length > 1 ? 0 : 0);
      const isSpecial = g.id === 'sg-internet' || g.id === 'sg-any';
      const isIsolated = isolatedNodeId !== null && isolatedNodeId !== g.id;
      const isFocused = isolatedNodeId === g.id;

      // Posture risk — only shown in posture mode
      let riskLevel: GroupNodeData['riskLevel'] = 'none';
      if (showPostureMode) {
        const ob = outbound.get(g.id) ?? 0;
        const ib = inbound.get(g.id) ?? 0;
        if (ob > 10 || ib > 10) riskLevel = 'critical';
        else if (ob > 5 || ib > 5) riskLevel = 'warn';
      }

      nodes.push({
        id: g.id,
        type: 'groupNode',
        position: { x, y: bandY },
        data: {
          group: g,
          inboundCount: inbound.get(g.id) ?? 0,
          outboundCount: outbound.get(g.id) ?? 0,
          isIsolated,
          isFocused,
          isSpecial,
          riskLevel,
        },
      });
    });
  }

  return nodes;
}

function buildReactFlowEdges(
  groupedEdges: GroupedEdge[],
  filterAction: GraphState['filterAction'],
  filterHasWebGroup: boolean,
  filterHasThreatGroup: boolean,
  isolatedNodeId: string | null,
): Edge[] {
  return groupedEdges
    .filter((ge) => {
      if (filterAction !== 'all' && ge.effectiveAction !== filterAction) return false;
      if (filterHasWebGroup && !ge.hasL7Inspection) return false;
      if (filterHasThreatGroup && !ge.policies.some((p) => !!p.threatGroup)) return false;
      if (
        isolatedNodeId !== null &&
        ge.source !== isolatedNodeId &&
        ge.target !== isolatedNodeId
      ) {
        return false;
      }
      return true;
    })
    .map((ge) => {
      const stroke = edgeColor(ge.effectiveAction);
      const strokeDasharray = ge.hasUnenforced ? '5 3' : undefined;
      const style: React.CSSProperties = { stroke, strokeWidth: 2 };
      if (strokeDasharray) style.strokeDasharray = strokeDasharray;

      return {
        id: ge.id,
        source: ge.source,
        target: ge.target,
        type: 'policy',
        style,
        markerEnd: {
          type: 'arrowclosed' as const,
          color: stroke,
          width: 16,
          height: 16,
        },
        data: { grouped: ge },
        label: ge.policies.length > 1 ? `${ge.policies.length}` : undefined,
        labelStyle: { fontSize: 10, fontFamily: 'ui-monospace, monospace', fill: stroke },
        labelBgStyle: { fill: 'rgba(15,23,42,0.85)' },
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 3,
      } satisfies Edge;
    });
}

// ---------------------------------------------------------------------------
// Inner graph — must be inside ReactFlowProvider to call useReactFlow
// ---------------------------------------------------------------------------

function PolicyGraphInner({
  topology,
  onSelectNode,
  onSelectPolicy,
  onCreatePolicy,
  onSelectGroup,
}: PolicyGraphProps) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  // Fit view after first layout
  const [hasFit, setHasFit] = useState(false);

  // Graph toolbar state
  const [graphState, setGraphState] = useState<GraphState>({
    connectMode: false,
    connectSource: null,
    isolatedNodeId: null,
    filterAction: 'all',
    filterHasWebGroup: false,
    filterHasThreatGroup: false,
    showPostureMode: false,
  });

  const patchGraphState = useCallback((patch: Partial<GraphState>) => {
    setGraphState((prev) => ({ ...prev, ...patch }));
  }, []);

  // Build the canonical group list (real groups + always-present specials)
  const allGroups = useMemo((): SmartGroup[] => {
    const realGroups = topology.smartGroups;
    const hasInternet = realGroups.some((g) => g.id === 'sg-internet');
    const hasAny = realGroups.some((g) => g.id === 'sg-any');
    return [
      ...realGroups,
      ...(hasInternet ? [] : [SPECIAL_INTERNET]),
      ...(hasAny ? [] : [SPECIAL_ANY]),
    ];
  }, [topology.smartGroups]);

  const groupedEdges = useMemo(
    () => groupPoliciesIntoEdges(topology.policies),
    [topology.policies],
  );

  // Canvas width estimate — ReactFlow handles its own layout; we just need a
  // reasonable x-distribution seed. Use window.innerWidth as a proxy.
  const canvasWidth = typeof window !== 'undefined' ? window.innerWidth * 0.6 : 900;

  const rfNodes = useMemo(
    () =>
      buildReactFlowNodes(
        allGroups,
        groupedEdges,
        graphState.isolatedNodeId,
        graphState.showPostureMode,
        canvasWidth,
      ),
    [allGroups, groupedEdges, graphState.isolatedNodeId, graphState.showPostureMode, canvasWidth],
  );

  const rfEdges = useMemo(
    () =>
      buildReactFlowEdges(
        groupedEdges,
        graphState.filterAction,
        graphState.filterHasWebGroup,
        graphState.filterHasThreatGroup,
        graphState.isolatedNodeId,
      ),
    [groupedEdges, graphState.filterAction, graphState.filterHasWebGroup, graphState.filterHasThreatGroup, graphState.isolatedNodeId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Keep React Flow state in sync when topology or graph state changes.
  // Also re-fit the view whenever the node count changes (groups added/removed).
  const prevNodeCount = useRef(rfNodes.length);
  useEffect(() => {
    setNodes(rfNodes);
    if (rfNodes.length !== prevNodeCount.current) {
      prevNodeCount.current = rfNodes.length;
      setHasFit(false); // trigger re-fit on next nodesInitialized tick
    }
  }, [rfNodes, setNodes, setHasFit]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  // Fit view once nodes are measured (and again when node count changes)
  if (nodesInitialized && !hasFit) {
    setHasFit(true);
    fitView({ padding: 0.2, duration: 400 });
  }

  // ---------------------------------------------------------------------------
  // Node click handler
  // ---------------------------------------------------------------------------
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeId = node.id;

      if (graphState.connectMode) {
        if (!graphState.connectSource) {
          patchGraphState({ connectSource: nodeId });
          return;
        }
        if (graphState.connectSource === nodeId) {
          patchGraphState({ connectSource: null });
          return;
        }
        // Second click — create policy
        onCreatePolicy(graphState.connectSource, nodeId);
        patchGraphState({ connectMode: false, connectSource: null });
        return;
      }

      // Isolation toggle
      if (graphState.isolatedNodeId === nodeId) {
        patchGraphState({ isolatedNodeId: null });
      } else {
        patchGraphState({ isolatedNodeId: nodeId });
        onSelectNode(nodeId);
      }
    },
    [graphState.connectMode, graphState.connectSource, graphState.isolatedNodeId, patchGraphState, onCreatePolicy, onSelectNode],
  );

  // ---------------------------------------------------------------------------
  // Edge click handler
  // ---------------------------------------------------------------------------
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const ge = (edge.data as { grouped: GroupedEdge } | undefined)?.grouped;
      if (!ge || ge.policies.length === 0) return;
      // Highest priority = lowest priority number
      const topPolicy = ge.policies[0];
      if (!topPolicy) return;
      onSelectPolicy(topPolicy.id);
    },
    [onSelectPolicy],
  );

  // ---------------------------------------------------------------------------
  // Isolated node label
  // ---------------------------------------------------------------------------
  const isolatedNodeLabel = useMemo(() => {
    if (!graphState.isolatedNodeId) return undefined;
    return allGroups.find((g) => g.id === graphState.isolatedNodeId)?.name;
  }, [graphState.isolatedNodeId, allGroups]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  const isEmpty = topology.smartGroups.length === 0 && topology.policies.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col h-full">
        <GraphToolbar
          state={graphState}
          onChange={patchGraphState}
          isolatedNodeLabel={isolatedNodeLabel}
          nodeCount={0}
          edgeCount={0}
          onFitView={() => fitView({ padding: 0.2, duration: 400 })}
        />
        <div
          className="flex-1 flex flex-col items-center justify-center text-center"
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
            <span className="text-2xl" style={{ color: 'var(--color-text-muted)' }}>⬡</span>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            No SmartGroups yet
          </p>
          <p
            className="text-xs mt-1 max-w-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
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
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <GraphToolbar
        state={graphState}
        onChange={patchGraphState}
        isolatedNodeLabel={isolatedNodeLabel}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        onFitView={() => fitView({ padding: 0.2, duration: 400 })}
      />

      <div className="flex-1 relative overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={2.5}
          style={{ backgroundColor: 'var(--color-surface)' }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="var(--color-border-subtle)"
          />
          <Controls
            showInteractive={false}
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 8,
            }}
          />
        </ReactFlow>

        {/* Connect-mode overlay hint */}
        {graphState.connectMode && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs font-medium pointer-events-none z-10 border"
            style={{
              backgroundColor: 'var(--color-surface-elevated)',
              borderColor: 'var(--color-aviatrix)',
              color: 'var(--color-aviatrix)',
            }}
          >
            {graphState.connectSource
              ? 'Click the destination node to create a policy'
              : 'Click the source node'}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export — wraps with ReactFlowProvider
// ---------------------------------------------------------------------------

export default function PolicyGraph(props: PolicyGraphProps) {
  return (
    <ReactFlowProvider>
      <PolicyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
