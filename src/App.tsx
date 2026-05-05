import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type ReactFlowInstance,
  type Connection,
  type XYPosition,
  Panel,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { demoTopology } from './data/demoTopology';
import type { DcfTopology, DcfPolicy, GatewayType } from './types/dcf';
import VpcNode from './components/nodes/VpcNode';
import GatewayNode from './components/nodes/GatewayNode';
import SmartGroupNode from './components/nodes/SmartGroupNode';
import PolicyEdge from './components/edges/PolicyEdge';
import InspectorPanel from './components/panels/InspectorPanel';
import PolicyMatrix from './components/panels/PolicyMatrix';
import TrafficFlowPanel from './components/panels/TrafficFlowPanel';
import NodePalette from './components/panels/NodePalette';
import { downloadTerraform, generateTerraform } from './lib/terraformExport';
import { decryptTopology, saveTopologyStorage } from './lib/cryptoStorage';
import { saveTopologyToCloud, loadTopologyFromCloud } from './lib/upstashSync';
import { useTheme } from './lib/ThemeContext';

import {
  LayoutGrid,
  Network,
  Activity,
  Info,
  Sun,
  Moon,
  Search,
  Download,
  FileCode,
  X,
  Copy,
  Check,
  HelpCircle,
  Sparkles,
  Map as MapIcon,
  Shield,
  Zap,
  RotateCcw,
  Trash2,
  PanelLeft,
  CloudUpload,
  CloudDownload,
} from 'lucide-react';

type ViewMode = 'topology' | 'policies' | 'traffic';



const nodeTypes = {
  vpc: VpcNode,
  gateway: GatewayNode,
  smartGroup: SmartGroupNode,
};

const edgeTypes = {
  policy: PolicyEdge,
};

function buildTopologyNodes(topology: DcfTopology, filter: string): Node[] {
  const f = filter.toLowerCase();
  const nodes: Node[] = [];
  const xGap = 280;

  topology.vpcs.forEach((vpc, i) => {
    const match = !f || vpc.name.toLowerCase().includes(f) || vpc.cidr.includes(f) || vpc.account.toLowerCase().includes(f);
    nodes.push({
      id: vpc.id,
      type: 'vpc',
      position: { x: 60 + i * xGap, y: 0 },
      data: { name: vpc.name, cidr: vpc.cidr, account: vpc.account },
      hidden: !match,
    });
  });

  const gatewaysByVpc: Record<string, typeof topology.gateways> = {};
  topology.gateways.forEach((gw) => {
    if (!gatewaysByVpc[gw.vpcId]) gatewaysByVpc[gw.vpcId] = [];
    gatewaysByVpc[gw.vpcId].push(gw);
  });

  Object.entries(gatewaysByVpc).forEach(([vpcId, gateways]) => {
    const vpcNode = nodes.find((n) => n.id === vpcId);
    if (!vpcNode) return;
    gateways.forEach((gw, j) => {
      const match = !f || gw.name.toLowerCase().includes(f) || gw.type.toLowerCase().includes(f);
      nodes.push({
        id: gw.id,
        type: 'gateway',
        position: { x: (vpcNode.position.x || 0) + j * 140, y: (vpcNode.position.y || 0) + 100 },
        data: { name: gw.name, type: gw.type, haEnabled: gw.haEnabled, ip: gw.ip },
        hidden: !match,
      });
    });
  });

  return nodes;
}

function buildTopologyEdges(topology: DcfTopology, filter: string): Edge[] {
  const f = filter.toLowerCase();
  const edges: Edge[] = [];

  topology.gateways.forEach((gw) => {
    const match = !f || gw.name.toLowerCase().includes(f) || gw.type.toLowerCase().includes(f);
    edges.push({
      id: `e-${gw.vpcId}-${gw.id}`,
      source: gw.vpcId,
      target: gw.id,
      type: 'smoothstep',
      style: { stroke: '#6b7280', strokeWidth: 1, opacity: 0.3 },
      hidden: !match,
    });
  });

  return edges;
}

function buildPolicyNodes(topology: DcfTopology, filter: string): Node[] {
  const f = filter.toLowerCase();
  const nodes: Node[] = [];
  const sgList = topology.smartGroups.filter((g) => g.id !== 'sg-internet');
  const angleStep = (2 * Math.PI) / sgList.length;
  const radius = 300;
  const center = { x: 400, y: 350 };

  sgList.forEach((sg, i) => {
    const match = !f || sg.name.toLowerCase().includes(f) || sg.criteria.some((c) => c.key.toLowerCase().includes(f) || c.value.toLowerCase().includes(f));
    const angle = angleStep * i - Math.PI / 2;
    nodes.push({
      id: sg.id,
      type: 'smartGroup',
      position: {
        x: center.x + radius * Math.cos(angle) - 75,
        y: center.y + radius * Math.sin(angle) - 30,
      },
      data: {
        name: sg.name,
        color: sg.color,
        criteria: sg.criteria,
        workloadCount: sg.workloadCount,
      },
      hidden: !match,
    });
  });

  const internetMatch = !f || 'internet'.includes(f);
  nodes.push({
    id: 'sg-internet',
    type: 'smartGroup',
    position: { x: center.x - 75, y: center.y + 380 },
    data: {
      name: 'Internet',
      color: '#ef4444',
      criteria: [],
      workloadCount: 0,
    },
    hidden: !internetMatch,
  });

  return nodes;
}

function buildPolicyEdges(topology: DcfTopology, filter: string): Edge[] {
  const f = filter.toLowerCase();
  const edges: Edge[] = [];

  topology.policies.forEach((pol) => {
    const srcExists = topology.smartGroups.some((g) => g.id === pol.srcGroupId);
    const dstExists = topology.smartGroups.some((g) => g.id === pol.dstGroupId);
    if (!srcExists || !dstExists) return;

    const match = !f || pol.name.toLowerCase().includes(f) || pol.protocol.toLowerCase().includes(f) || (pol.ports || '').includes(f);

    edges.push({
      id: `pol-${pol.id}`,
      source: pol.srcGroupId,
      target: pol.dstGroupId,
      type: 'policy',
      data: {
        action: pol.action,
        protocol: pol.protocol,
        ports: pol.ports,
        logging: pol.logging,
        decrypt: pol.decrypt,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: pol.action === 'allow' ? '#10b981' : '#ef4444' },
      hidden: !match,
    });
  });

  return edges;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [topology, setTopology] = useState<DcfTopology>(demoTopology);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('topology');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTerraformModal, setShowTerraformModal] = useState(false);
  const [terraformCopied, setTerraformCopied] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [storageReady, setStorageReady] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'saving' | 'loading' | 'saved' | 'error'>('idle');

  const nodePositionsRef = useRef<Map<string, XYPosition>>(new Map());
  const dropCountRef = useRef(0);

  // Load encrypted topology on mount
  useEffect(() => {
    let cancelled = false;
    decryptTopology<DcfTopology>().then((saved) => {
      if (cancelled) return;
      if (saved) {
        setTopology(saved);
      } else {
        // Fallback: try old plaintext format for migration
        try {
          const plain = localStorage.getItem('dcf-topology-v1');
          if (plain) {
            const parsed = JSON.parse(plain);
            setTopology(parsed);
            saveTopologyStorage(parsed).catch(() => {});
          }
        } catch { /* ignore */ }
      }
      setStorageReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Persist topology to encrypted localStorage
  useEffect(() => {
    if (storageReady) {
      saveTopologyStorage(topology).catch(() => {});
    }
  }, [topology, storageReady]);

  // Derive nodes/edges from topology, preserving positions
  useEffect(() => {
    if (viewMode === 'topology') {
      const built = buildTopologyNodes(topology, searchQuery);
      const builtEdges = buildTopologyEdges(topology, searchQuery);
      setNodes((prev) => {
        const posMap = nodePositionsRef.current;
        const prevMap = new Map(prev.map((n) => [n.id, n]));
        return built.map((n) => {
          const pos = posMap.get(n.id);
          const prevNode = prevMap.get(n.id);
          return {
            ...n,
            position: pos ?? n.position,
            selected: prevNode?.selected ?? false,
          };
        });
      });
      setEdges(builtEdges);
    } else if (viewMode === 'policies') {
      const built = buildPolicyNodes(topology, searchQuery);
      const builtEdges = buildPolicyEdges(topology, searchQuery);
      setNodes((prev) => {
        const posMap = nodePositionsRef.current;
        const prevMap = new Map(prev.map((n) => [n.id, n]));
        return built.map((n) => {
          const pos = posMap.get(n.id);
          const prevNode = prevMap.get(n.id);
          return {
            ...n,
            position: pos ?? n.position,
            selected: prevNode?.selected ?? false,
          };
        });
      });
      setEdges(builtEdges);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [topology, viewMode, searchQuery]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((c) => {
        if (c.type === 'position' && c.position) {
          nodePositionsRef.current.set(c.id, c.position);
        }
        if (c.type === 'remove') {
          nodePositionsRef.current.delete(c.id);
        }
      });
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    []
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedNodeType(node.type || null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedNodeType(null);
  }, []);

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedNodeId(null);
    setSelectedNodeType(null);
    if (reactFlowInstance) {
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.2 }), 50);
    }
  };

  const handleCopyTerraform = () => {
    navigator.clipboard.writeText(generateTerraform(topology));
    setTerraformCopied(true);
    setTimeout(() => setTerraformCopied(false), 2000);
  };

  const handleDownloadTerraform = () => {
    downloadTerraform(topology);
  };

  const handleUpdateNode = useCallback(
    (nodeId: string, nodeType: string, data: Record<string, unknown>) => {
      setTopology((prev) => {
        switch (nodeType) {
          case 'vpc':
            return {
              ...prev,
              vpcs: prev.vpcs.map((v) => (v.id === nodeId ? { ...v, ...data } : v)),
            };
          case 'gateway':
            return {
              ...prev,
              gateways: prev.gateways.map((g) => (g.id === nodeId ? { ...g, ...data } : g)),
            };
          case 'smartGroup':
            return {
              ...prev,
              smartGroups: prev.smartGroups.map((s) => (s.id === nodeId ? { ...s, ...data } : s)),
            };
          default:
            return prev;
        }
      });
      // Immediate feedback: also patch node data directly
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)));
    },
    []
  );

  const handleDeleteNode = useCallback(
    (nodeId: string, nodeType: string) => {
      setTopology((prev) => {
        switch (nodeType) {
          case 'vpc':
            return {
              ...prev,
              vpcs: prev.vpcs.filter((v) => v.id !== nodeId),
              gateways: prev.gateways.filter((g) => g.vpcId !== nodeId),
            };
          case 'gateway':
            return { ...prev, gateways: prev.gateways.filter((g) => g.id !== nodeId) };
          case 'smartGroup':
            return {
              ...prev,
              smartGroups: prev.smartGroups.filter((s) => s.id !== nodeId),
              policies: prev.policies.filter((p) => p.srcGroupId !== nodeId && p.dstGroupId !== nodeId),
            };
          default:
            return prev;
        }
      });
      nodePositionsRef.current.delete(nodeId);
      setSelectedNodeId(null);
      setSelectedNodeType(null);
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      if (viewMode === 'topology') {
        const sourceNode = nodes.find((n) => n.id === connection.source);
        const targetNode = nodes.find((n) => n.id === connection.target);

        if (sourceNode?.type === 'vpc' && targetNode?.type === 'gateway') {
          setTopology((prev) => ({
            ...prev,
            gateways: prev.gateways.map((g) => (g.id === connection.target ? { ...g, vpcId: connection.source! } : g)),
          }));
        }
      } else if (viewMode === 'policies') {
        const newPolicy: DcfPolicy = {
          id: `pol-${Date.now()}`,
          name: 'New Policy',
          priority: 100,
          srcGroupId: connection.source,
          dstGroupId: connection.target,
          action: 'allow',
          direction: 'any',
          protocol: 'tcp',
          ports: 'any',
          logging: false,
        };
        setTopology((prev) => ({
          ...prev,
          policies: [...prev.policies, newPolicy],
        }));
      }
    },
    [viewMode, nodes]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!reactFlowInstance) return;

      const raw = event.dataTransfer.getData('application/reactflow');
      if (!raw) return;
      let item: { type: string; label: string } | null = null;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      if (!item) return;

      const basePosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // Stagger drops so nodes don't stack exactly on top of each other
      const offsetX = (dropCountRef.current % 5) * 24;
      const offsetY = Math.floor(dropCountRef.current / 5) * 24;
      dropCountRef.current += 1;
      const position = { x: basePosition.x + offsetX, y: basePosition.y + offsetY };
      const id = `${item.type}-${Date.now()}`;
      nodePositionsRef.current.set(id, position);

      switch (item.type) {
        case 'vpc': {
          const newVpc = {
            id,
            name: 'New VPC',
            cidr: '10.0.0.0/16',
            account: 'default',
          };
          setTopology((prev) => ({ ...prev, vpcs: [...prev.vpcs, newVpc] }));
          break;
        }
        case 'gateway':
        case 'gateway-spoke': {
          const gwType: GatewayType =
            item.type === 'gateway-spoke'
              ? 'spoke'
              : 'transit';
          const firstVpc = topology.vpcs[0]?.id ?? 'vpc-orphan';
          const newGw = {
            id,
            name: `New ${gwType.charAt(0).toUpperCase() + gwType.slice(1)} GW`,
            type: gwType,
            vpcId: firstVpc,
            haEnabled: false,
            ip: '',
          };
          setTopology((prev) => ({ ...prev, gateways: [...prev.gateways, newGw] }));
          break;
        }
        case 'smartGroup': {
          const newSg = {
            id,
            name: 'New Smart Group',
            color: '#3b82f6',
            criteria: [] as { key: string; operator: 'equals' | 'contains' | 'startsWith'; value: string }[],
            workloadCount: 0,
            vpcIds: [] as string[],
          };
          setTopology((prev) => ({ ...prev, smartGroups: [...prev.smartGroups, newSg] }));
          break;
        }
      }
    },
    [reactFlowInstance, topology]
  );

  const handleResetDemo = () => {
    setConfirmModal({
      open: true,
      title: 'Reset to Demo',
      message: 'All unsaved changes will be lost. Your current topology will be replaced with the demo data.',
      onConfirm: () => {
        nodePositionsRef.current = new Map();
        setTopology(demoTopology);
        setSelectedNodeId(null);
        setSelectedNodeType(null);
        setConfirmModal((prev) => ({ ...prev, open: false }));
      },
    });
  };

  const handleSaveToCloud = async () => {
    setCloudSyncStatus('saving');
    try {
      await saveTopologyToCloud(topology);
      setCloudSyncStatus('saved');
      setTimeout(() => setCloudSyncStatus('idle'), 2000);
    } catch {
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus('idle'), 3000);
    }
  };

  const handleLoadFromCloud = async () => {
    setCloudSyncStatus('loading');
    try {
      const saved = await loadTopologyFromCloud();
      if (saved) {
        nodePositionsRef.current = new Map();
        setTopology(saved);
        setSelectedNodeId(null);
        setSelectedNodeType(null);
      }
      setCloudSyncStatus('idle');
    } catch {
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus('idle'), 3000);
    }
  };

  const handleClearCanvas = () => {
    setConfirmModal({
      open: true,
      title: 'Clear Canvas',
      message: 'This will remove all nodes, edges, and policies. This action cannot be undone.',
      onConfirm: () => {
        nodePositionsRef.current = new Map();
        setTopology({
          vpcs: [],
          gateways: [],
          smartGroups: [{ id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], workloadCount: 0, vpcIds: [] }],
          policies: [],
          threatGroups: [],
          geoGroups: [],
          flows: [],
        });
        setSelectedNodeId(null);
        setSelectedNodeType(null);
        setConfirmModal((prev) => ({ ...prev, open: false }));
      },
    });
  };

  return (
    <div className="flex h-full w-full">
      {/* Node Palette */}
      {viewMode !== 'traffic' && showPalette && <NodePalette />}

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex items-center justify-between px-4 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <img src="/logo-header.png" alt="DCF Visualizer" className="h-7 w-auto rounded-md" />
              <h1 className="text-sm font-bold text-[var(--color-text-primary)] tracking-wide hidden sm:inline">visualizer</h1>
            </div>
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-1 shrink-0" />
            <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5 border border-[var(--color-border-subtle)] shrink-0">
              <button
                onClick={() => handleViewChange('topology')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'topology'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <Network size={14} />
                <span className="hidden sm:inline">Topology</span>
              </button>
              <button
                onClick={() => handleViewChange('policies')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'policies'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <LayoutGrid size={14} />
                <span className="hidden sm:inline">Policies</span>
              </button>
              <button
                onClick={() => handleViewChange('traffic')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'traffic'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <Activity size={14} />
                <span className="hidden sm:inline">Traffic</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Palette Toggle */}
            {viewMode !== 'traffic' && (
              <button
                onClick={() => setShowPalette((v) => !v)}
                className={`p-1.5 rounded-md border transition-colors ${showPalette ? 'text-[var(--color-aviatrix)]' : 'text-[var(--color-text-secondary)]'}`}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border-subtle)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  e.currentTarget.style.color = showPalette ? 'var(--color-aviatrix)' : 'var(--color-text-secondary)';
                }}
                title="Toggle Palette"
              >
                <PanelLeft size={14} />
              </button>
            )}

            {/* Search */}
            <div className="relative hidden lg:block">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-1.5 rounded-md text-xs w-40 border outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-input-bg)',
                  borderColor: 'var(--color-input-border)',
                  color: 'var(--color-text-primary)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
              />
            </div>

            {/* Reset Demo */}
            <button
              onClick={handleResetDemo}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title="Reset to Demo"
            >
              <RotateCcw size={14} />
            </button>

            {/* Clear Canvas */}
            <button
              onClick={handleClearCanvas}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title="Clear Canvas"
            >
              <Trash2 size={14} />
            </button>

            {/* Cloud Save */}
            <button
              onClick={handleSaveToCloud}
              disabled={cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading'}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') {
                  e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)';
              }}
              title={cloudSyncStatus === 'saved' ? 'Saved to cloud' : cloudSyncStatus === 'error' ? 'Sync failed' : 'Save to Cloud'}
            >
              {cloudSyncStatus === 'saving' ? (
                <span className="w-3.5 h-3.5 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
              ) : cloudSyncStatus === 'saved' ? (
                <Check size={14} />
              ) : (
                <CloudUpload size={14} />
              )}
            </button>

            {/* Cloud Load */}
            <button
              onClick={handleLoadFromCloud}
              disabled={cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading'}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') {
                  e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title="Load from Cloud"
            >
              {cloudSyncStatus === 'loading' ? (
                <span className="w-3.5 h-3.5 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <CloudDownload size={14} />
              )}
            </button>

            {/* Terraform Export */}
            <button
              onClick={() => setShowTerraformModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title="Export Terraform"
            >
              <FileCode size={14} />
              <span className="hidden lg:inline">TF Export</span>
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md border transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            <button
              onClick={() => setShowAboutModal(true)}
              className="p-1.5 rounded-md border transition-colors"
              style={{
                backgroundColor: 'var(--color-surface)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
              title="About DCF Visualizer"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>

        {/* Mobile Search */}
        <div className="md:hidden px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes, policies, protocols..."
              className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs border outline-none transition-colors"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: 'var(--color-input-border)',
                color: 'var(--color-text-primary)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative overflow-hidden">
          {viewMode === 'traffic' ? (
            <TrafficFlowPanel topology={topology} filter={searchQuery} />
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={setReactFlowInstance}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: false }}
            >
              <Background color={theme === 'dark' ? '#2a2d3a' : '#dee2e6'} gap={20} size={1} />
              <Controls />
              <MiniMap
                nodeColor={(node) => {
                  if (node.hidden) return 'transparent';
                  if (node.type === 'vpc') return '#06b6d4';
                  if (node.type === 'gateway') {
                    const type = (node.data as any)?.type;
                    if (type === 'transit') return '#3b82f6';
                    return '#06b6d4';
                  }
                  if (node.type === 'smartGroup') return (node.data as any)?.color || '#666';
                  return '#666';
                }}
                maskColor={theme === 'dark' ? 'rgba(15, 17, 23, 0.7)' : 'rgba(248, 249, 250, 0.7)'}
                className="!bg-[var(--color-surface-raised)] !border-[var(--color-border-subtle)]"
              />
              <Panel position="top-right" className="m-4">
                <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-xs shadow-lg" style={{ color: 'var(--color-text-muted)' }}>
                  <div className="font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Legend</div>
                  {viewMode === 'topology' ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#06b6d4]" /> VPC / VNet</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Transit GW</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#06b6d4]" /> Spoke GW</div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-green-400" /> Allow</div>
                      <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-red-400" style={{ borderBottom: '1px dashed' }} /> Deny</div>
                      <div className="text-[10px] mt-1 opacity-70">Click edges for policy details</div>
                    </div>
                  )}
                </div>
              </Panel>
            </ReactFlow>
          )}
        </div>
      </div>

      {/* Right Panel */}
      {viewMode === 'policies' ? (
        <PolicyMatrix topology={topology} />
      ) : (
        <InspectorPanel
          topology={topology}
          selectedNodeId={selectedNodeId}
          selectedNodeType={selectedNodeType}
          onClose={() => { setSelectedNodeId(null); setSelectedNodeType(null); }}
          onUpdateNode={handleUpdateNode}
          onDeleteNode={handleDeleteNode}
        />
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2">
                <img src="/logo-header.png" alt="DCF Visualizer" className="h-5 w-auto rounded" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>About DCF Visualizer</h3>
              </div>
              <button
                onClick={() => setShowAboutModal(false)}
                className="p-1 rounded hover:bg-[var(--color-button-hover)] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>What is this?</p>
                <p>
                  DCF Visualizer is an interactive demo application for exploring{' '}
                  <span className="font-semibold" style={{ color: 'var(--color-aviatrix)' }}>Aviatrix Distributed Cloud Firewall (DCF)</span>{' '}
                  topologies, micro-segmentation policies, and traffic flows. It helps network and security engineers visualize cloud network architectures, smart groups, and policy enforcement across multi-cloud environments.
                </p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                  <Sparkles size={14} className="text-amber-400" /> Current Features
                </p>
                <ul className="space-y-1.5 pl-1">
                  <li className="flex items-start gap-2">
                    <MapIcon size={13} className="mt-0.5 shrink-0 text-blue-400" />
                    <span><strong>Topology View</strong> — Interactive graph of VPCs/VNets and gateways (DCF, Transit, Egress, Edge).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Shield size={13} className="mt-0.5 shrink-0 text-green-400" />
                    <span><strong>Policies View</strong> — Visual policy matrix showing allow/deny rules between Smart Groups with edge inspection.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Zap size={13} className="mt-0.5 shrink-0 text-yellow-400" />
                    <span><strong>Traffic Flow</strong> — Simulated traffic analysis across VPCs, protocols, and workload types.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Search size={13} className="mt-0.5 shrink-0 text-purple-400" />
                    <span><strong>Global Search</strong> — Filter nodes, policies, protocols, and CIDRs across all views.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <FileCode size={13} className="mt-0.5 shrink-0 text-cyan-400" />
                    <span><strong>Terraform Export</strong> — Generate HCL for Aviatrix provider from the demo topology.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Sun size={13} className="mt-0.5 shrink-0 text-orange-400" />
                    <span><strong>Dark &amp; Light Mode</strong> — Full theme support with system-aware defaults.</span>
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                  <Info size={14} className="text-blue-400" /> Planned Features
                </p>
                <ul className="space-y-1 pl-1">
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Live API integration with Aviatrix Controller</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Real-time traffic simulation &amp; flow logs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Cost estimation dashboard per VPC/gateway</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Multi-tenant &amp; RBAC policy visualization</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Custom topology import (YAML/JSON/Terraform)</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Policy change history &amp; audit timeline</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                    <span>Alerting &amp; SIEM integration hooks</span>
                  </li>
                </ul>
              </div>

              <div className="p-3 rounded-lg border text-[10px]" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
                <span className="font-semibold text-amber-400">⚠ Security Notice:</span> Topology data is stored locally in your browser using client-side encryption. Do not use this tool for production secrets or sensitive network architecture.
              </div>

              <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Built with React, Tailwind CSS, and @xyflow. Deployed on Vercel.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-sm flex flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{confirmModal.title}</h3>
            </div>
            <div className="p-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {confirmModal.message}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <button
                onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix-dark)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix)')}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terraform Export Modal */}
      {showTerraformModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2">
                <FileCode size={16} className="text-[var(--color-accent-blue)]" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Terraform Export</h3>
              </div>
              <button
                onClick={() => setShowTerraformModal(false)}
                className="p-1 rounded hover:bg-[var(--color-button-hover)] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b text-[10px]" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
              <Info size={12} />
              <span>{`Generated HCL for Aviatrix provider >= 2.22.0. Validate against your provider version.`}</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre
                className="text-xs font-mono p-4 rounded-lg overflow-auto leading-relaxed"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-subtle)' }}
              >
                {generateTerraform(topology)}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <button
                onClick={handleCopyTerraform}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surface)';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                {terraformCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                {terraformCopied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button
                onClick={handleDownloadTerraform}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix-dark)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix)')}
              >
                <Download size={14} />
                Download .tf
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
