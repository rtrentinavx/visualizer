import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { Plus } from 'lucide-react';
import type { DcfPolicyModel, SmartGroup } from '../../types/dcf';
import GraphToolbar, { type GraphState } from '../graph/GraphToolbar';
import { groupPoliciesIntoEdges, type GroupedEdge } from '../graph/edgeUtils';

// ---------------------------------------------------------------------------
// Props — identical to PolicyGraph.tsx
// ---------------------------------------------------------------------------

interface PolicyGraphProps {
  topology: DcfPolicyModel;
  onSelectNode: (groupId: string) => void;
  onSelectPolicy: (policyId: string) => void;
  onCreatePolicy: (srcId: string, dstId: string) => void;
  onSelectGroup: (groupId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPECIAL_INTERNET: SmartGroup = {
  id: 'sg-internet',
  name: 'Internet',
  color: '#64748b',
  criteria: [],
  matchType: 'any',
};

const SPECIAL_ANY: SmartGroup = {
  id: 'sg-any',
  name: 'Any',
  color: '#8b5cf6',
  criteria: [],
  matchType: 'any',
};


// ---------------------------------------------------------------------------
// Force-graph node/link types
// ---------------------------------------------------------------------------

interface FGNode {
  id: string;
  name: string;
  color: string;
  riskLevel: 'none' | 'warn' | 'critical';
  inboundCount: number;
  outboundCount: number;
  isIsolated: boolean;
  isFocused: boolean;
  isConnectSource: boolean;
  // runtime coords injected by force-graph engine
  x?: number;
  y?: number;
  z?: number;
}

interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  grouped: GroupedEdge;
  color: string;
  width: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgeColor(effectiveAction: GroupedEdge['effectiveAction']): string {
  if (effectiveAction === 'allow') return '#22c55e';
  if (effectiveAction === 'deny') return '#ef4444';
  if (effectiveAction === 'mixed') return '#a855f7';
  return '#f59e0b'; // learned
}

function buildGraphData(
  allGroups: SmartGroup[],
  groupedEdges: GroupedEdge[],
  graphState: GraphState,
): { nodes: FGNode[]; links: FGLink[] } {
  const { isolatedNodeId, showPostureMode, filterAction, filterHasWebGroup, filterHasThreatGroup, connectSource } = graphState;

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const ge of groupedEdges) {
    inbound.set(ge.target, (inbound.get(ge.target) ?? 0) + ge.policies.length);
    outbound.set(ge.source, (outbound.get(ge.source) ?? 0) + ge.policies.length);
  }

  const nodes: FGNode[] = allGroups.map((g) => {
    const ob = outbound.get(g.id) ?? 0;
    const ib = inbound.get(g.id) ?? 0;
    let riskLevel: FGNode['riskLevel'] = 'none';
    if (showPostureMode) {
      if (ob > 10 || ib > 10) riskLevel = 'critical';
      else if (ob > 5 || ib > 5) riskLevel = 'warn';
    }
    return {
      id: g.id,
      name: g.name,
      color: g.color ?? '#64748b',
      riskLevel,
      inboundCount: ib,
      outboundCount: ob,
      isIsolated: isolatedNodeId !== null && isolatedNodeId !== g.id,
      isFocused: isolatedNodeId === g.id,
      isConnectSource: connectSource === g.id,
    };
  });

  const links: FGLink[] = groupedEdges
    .filter((ge) => {
      // sg-any is a wildcard — skip edges where it's the source or target
      if (ge.source === 'sg-any' || ge.target === 'sg-any') return false;
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
    .map((ge) => ({
      source: ge.source,
      target: ge.target,
      grouped: ge,
      color: edgeColor(ge.effectiveAction),
      width: ge.hasL7Inspection ? 3 : 2,
    }));

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// 3D node object factory
// ---------------------------------------------------------------------------

function makeNodeObject(node: FGNode): THREE.Object3D {
  const group = new THREE.Group();

  const trafficBonus = Math.min(2, (node.inboundCount + node.outboundCount) / 10);
  const radius = 5 + trafficBonus;

  let sphereColor = node.color;
  if (node.riskLevel === 'critical') sphereColor = '#ef4444';
  else if (node.riskLevel === 'warn') sphereColor = '#f59e0b';

  const opacity = node.isIsolated ? 0.15 : 1;

  const sphereGeo = new THREE.SphereGeometry(radius, 16, 16);
  const sphereMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(sphereColor),
    transparent: opacity < 1,
    opacity,
  });
  group.add(new THREE.Mesh(sphereGeo, sphereMat));

  if (node.isFocused) {
    const ringGeo = new THREE.TorusGeometry(radius + 2, 0.8, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
    group.add(new THREE.Mesh(ringGeo, ringMat));
  }

  if (node.isConnectSource) {
    const ringGeo = new THREE.TorusGeometry(radius + 2, 0.8, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    group.add(new THREE.Mesh(ringGeo, ringMat));
  }

  const label = new SpriteText(node.name);
  label.textHeight = 4;
  label.color = node.isIsolated ? '#6b7280' : '#f1f5f9';
  label.backgroundColor = 'rgba(15,23,42,0.75)';
  label.padding = 2;
  label.borderRadius = 3;
  label.position.y = radius + 6;
  group.add(label);

  if (node.inboundCount > 0 && !node.isIsolated) {
    const ib = new SpriteText(`↓ ${node.inboundCount}`);
    ib.textHeight = 3;
    ib.color = '#86efac';
    ib.backgroundColor = 'rgba(15,23,42,0.7)';
    ib.padding = 1.5;
    ib.position.set(radius + 4, 0, 0);
    group.add(ib);
  }

  if (node.outboundCount > 0 && !node.isIsolated) {
    const ob = new SpriteText(`↑ ${node.outboundCount}`);
    ob.textHeight = 3;
    ob.color = '#93c5fd';
    ob.backgroundColor = 'rgba(15,23,42,0.7)';
    ob.padding = 1.5;
    ob.position.set(-(radius + 4), 0, 0);
    group.add(ob);
  }

  return group;
}

function getResolvedBg(): string {
  if (typeof document === 'undefined') return '#0f172a';
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface')
    .trim();
  return raw || '#0f172a';
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PolicyForceGraph({
  topology,
  onSelectNode,
  onSelectPolicy,
  onCreatePolicy,
  onSelectGroup,
}: PolicyGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphInstanceRef = useRef<ForceGraph3DInstance | null>(null);

  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [graphState, setGraphState] = useState<GraphState>({
    connectMode: false,
    connectSource: null,
    isolatedNodeId: null,
    filterAction: 'all',
    filterHasWebGroup: false,
    filterHasThreatGroup: false,
    showPostureMode: false,
  });
  const graphStateRef = useRef(graphState);
  graphStateRef.current = graphState;

  const patchGraphState = useCallback((patch: Partial<GraphState>) => {
    setGraphState((prev) => ({ ...prev, ...patch }));
  }, []);

  const [overlayPositions, setOverlayPositions] = useState<{ id: string; x: number; y: number }[]>([]);
  const rafRef = useRef<number | null>(null);

  const allGroups = useMemo((): SmartGroup[] => {
    const real = topology.smartGroups;
    const hasInternet = real.some((g) => g.id === 'sg-internet');
    const hasAny = real.some((g) => g.id === 'sg-any');
    return [
      ...real,
      ...(hasInternet ? [] : [SPECIAL_INTERNET]),
      ...(hasAny ? [] : [SPECIAL_ANY]),
    ];
  }, [topology.smartGroups]);

  const groupedEdges = useMemo(
    () => groupPoliciesIntoEdges(topology.policies),
    [topology.policies],
  );

  const graphData = useMemo(
    () => buildGraphData(allGroups, groupedEdges, graphState),
    [allGroups, groupedEdges, graphState],
  );

  // Stable callback refs so graph callbacks always see current state
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;
  const onCreatePolicyRef = useRef(onCreatePolicy);
  onCreatePolicyRef.current = onCreatePolicy;
  const onSelectPolicyRef = useRef(onSelectPolicy);
  onSelectPolicyRef.current = onSelectPolicy;

  // Mount the 3d-force-graph instance once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const graph = new ForceGraph3D(el, { controlType: 'orbit' })
      .nodeId('id')
      .nodeLabel('name')
      .nodeThreeObject((n) => makeNodeObject(n as FGNode))
      .nodeThreeObjectExtend(false)
      .linkColor((l) => (l as FGLink).color)
      .linkWidth((l) => (l as FGLink).width)
      .linkDirectionalArrowLength(4)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticles((l) =>
        (l as FGLink).grouped.effectiveAction === 'allow' ? 2 : 0,
      )
      .linkDirectionalParticleSpeed(0.005)
      .backgroundColor(getResolvedBg())
      .onNodeClick((n) => {
        const node = n as FGNode;
        const state = graphStateRef.current;
        if (state.connectMode) {
          if (!state.connectSource) {
            setGraphState((prev) => ({ ...prev, connectSource: node.id }));
            return;
          }
          if (state.connectSource === node.id) {
            setGraphState((prev) => ({ ...prev, connectSource: null }));
            return;
          }
          onCreatePolicyRef.current(state.connectSource, node.id);
          setGraphState((prev) => ({ ...prev, connectMode: false, connectSource: null }));
          return;
        }
        if (state.isolatedNodeId === node.id) {
          setGraphState((prev) => ({ ...prev, isolatedNodeId: null }));
        } else {
          setGraphState((prev) => ({ ...prev, isolatedNodeId: node.id }));
          onSelectNodeRef.current(node.id);
        }
      })
      .onLinkClick((l) => {
        const link = l as FGLink;
        const ge = link.grouped;
        if (!ge || ge.policies.length === 0) return;
        const topPolicy = ge.policies[0];
        if (!topPolicy) return;
        onSelectPolicyRef.current(topPolicy.id);
      })
      .width(dims.w)
      .height(dims.h);

    graphInstanceRef.current = graph;

    // Initial fit after physics settles
    const t = setTimeout(() => graph.zoomToFit(400, 150), 800);

    return () => {
      clearTimeout(t);
      graph._destructor();
      graphInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update graph data whenever it changes
  useEffect(() => {
    graphInstanceRef.current?.graphData(graphData);
  }, [graphData]);

  // Update canvas size when dims change
  useEffect(() => {
    graphInstanceRef.current?.width(dims.w).height(dims.h);
  }, [dims.w, dims.h]);

  // Re-fit when node count changes
  const prevNodeCount = useRef(graphData.nodes.length);
  useEffect(() => {
    if (graphData.nodes.length !== prevNodeCount.current) {
      prevNodeCount.current = graphData.nodes.length;
      const t = setTimeout(() => graphInstanceRef.current?.zoomToFit(400, 150), 600);
      return () => clearTimeout(t);
    }
  }, [graphData.nodes.length]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setDims({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // RAF loop for DOM overlay positions while connect mode is active
  useEffect(() => {
    if (!graphState.connectMode) {
      setOverlayPositions([]);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const graph = graphInstanceRef.current;
      if (!graph) return;
      const data = graph.graphData() as unknown as { nodes: FGNode[] };
      const positions = data.nodes.map((n) => {
        const coords = graph.graph2ScreenCoords(n.x ?? 0, n.y ?? 0, n.z ?? 0);
        return { id: n.id, x: coords.x, y: coords.y };
      });
      setOverlayPositions(positions);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [graphState.connectMode]);

  const handleFitView = useCallback(() => {
    graphInstanceRef.current?.zoomToFit(400, 150);
  }, []);

  const isolatedNodeLabel = useMemo(() => {
    if (!graphState.isolatedNodeId) return undefined;
    return allGroups.find((g) => g.id === graphState.isolatedNodeId)?.name;
  }, [graphState.isolatedNodeId, allGroups]);

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
          onFitView={handleFitView}
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
        nodeCount={graphData.nodes.length}
        edgeCount={graphData.links.length}
        onFitView={handleFitView}
      />

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        data-testid="force-graph-container"
      >
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

        {/* DOM overlay for Playwright — invisible buttons positioned over each node */}
        {graphState.connectMode &&
          overlayPositions.map((pos) => (
            <button
              key={pos.id}
              data-testid={`fg-node-${pos.id}`}
              aria-label={allGroups.find((g) => g.id === pos.id)?.name ?? pos.id}
              onClick={() => {
                const graph = graphInstanceRef.current;
                if (!graph) return;
                const data = graph.graphData() as unknown as { nodes: FGNode[] };
                const node = data.nodes.find((n) => n.id === pos.id);
                if (!node) return;
                const state = graphStateRef.current;
                if (!state.connectSource) {
                  setGraphState((prev) => ({ ...prev, connectSource: pos.id }));
                  return;
                }
                if (state.connectSource === pos.id) {
                  setGraphState((prev) => ({ ...prev, connectSource: null }));
                  return;
                }
                onCreatePolicyRef.current(state.connectSource, pos.id);
                setGraphState((prev) => ({ ...prev, connectMode: false, connectSource: null }));
              }}
              style={{
                position: 'absolute',
                left: pos.x - 20,
                top: pos.y - 20,
                width: 40,
                height: 40,
                opacity: 0,
                cursor: 'pointer',
                zIndex: 5,
              }}
            />
          ))}
      </div>
    </div>
  );
}
