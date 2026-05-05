import { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type ReactFlowInstance,
  Panel,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { demoTopology } from './data/demoTopology';
import CloudRegionNode from './components/nodes/CloudRegionNode';
import VpcNode from './components/nodes/VpcNode';
import GatewayNode from './components/nodes/GatewayNode';
import SmartGroupNode from './components/nodes/SmartGroupNode';
import PolicyEdge from './components/edges/PolicyEdge';
import InspectorPanel from './components/panels/InspectorPanel';
import PolicyMatrix from './components/panels/PolicyMatrix';
import TrafficFlowPanel from './components/panels/TrafficFlowPanel';
import { downloadTerraform, generateTerraform } from './lib/terraformExport';
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
} from 'lucide-react';

type ViewMode = 'topology' | 'policies' | 'traffic';

const nodeTypes = {
  cloudRegion: CloudRegionNode,
  vpc: VpcNode,
  gateway: GatewayNode,
  smartGroup: SmartGroupNode,
};

const edgeTypes = {
  policy: PolicyEdge,
};

function buildTopologyNodes(topology: typeof demoTopology, filter: string): Node[] {
  const f = filter.toLowerCase();
  const nodes: Node[] = [];
  const xGap = 280;

  // Cloud regions at top
  topology.regions.forEach((region, i) => {
    const match = !f || region.name.toLowerCase().includes(f) || region.provider.toLowerCase().includes(f);
    nodes.push({
      id: region.id,
      type: 'cloudRegion',
      position: { x: 60 + i * xGap, y: 0 },
      data: { name: region.name, provider: region.provider, cidr: region.cidr },
      hidden: !match,
    });
  });

  // VPCs below regions
  const vpcsByRegion: Record<string, typeof topology.vpcs> = {};
  topology.vpcs.forEach((vpc) => {
    if (!vpcsByRegion[vpc.regionId]) vpcsByRegion[vpc.regionId] = [];
    vpcsByRegion[vpc.regionId].push(vpc);
  });

  Object.entries(vpcsByRegion).forEach(([regionId, vpcs]) => {
    const regionIndex = topology.regions.findIndex((r) => r.id === regionId);
    vpcs.forEach((vpc, j) => {
      const match = !f || vpc.name.toLowerCase().includes(f) || vpc.cidr.includes(f) || vpc.account.toLowerCase().includes(f);
      nodes.push({
        id: vpc.id,
        type: 'vpc',
        position: { x: 60 + regionIndex * xGap, y: 120 + j * 80 },
        data: { name: vpc.name, cidr: vpc.cidr, account: vpc.account },
        hidden: !match,
      });
    });
  });

  // Gateways below VPCs
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

function buildTopologyEdges(topology: typeof demoTopology, filter: string): Edge[] {
  const f = filter.toLowerCase();
  const edges: Edge[] = [];

  topology.vpcs.forEach((vpc) => {
    const match = !f || vpc.name.toLowerCase().includes(f);
    edges.push({
      id: `e-${vpc.regionId}-${vpc.id}`,
      source: vpc.regionId,
      target: vpc.id,
      type: 'smoothstep',
      style: { stroke: '#3b82f6', strokeWidth: 1, opacity: 0.4 },
      hidden: !match,
    });
  });

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

function buildPolicyNodes(topology: typeof demoTopology, filter: string): Node[] {
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

  // Internet node in center-bottom
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

function buildPolicyEdges(topology: typeof demoTopology, filter: string): Edge[] {
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
  const [viewMode, setViewMode] = useState<ViewMode>('topology');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTerraformModal, setShowTerraformModal] = useState(false);
  const [terraformCopied, setTerraformCopied] = useState(false);

  const nodes = useMemo(() => {
    if (viewMode === 'topology') return buildTopologyNodes(demoTopology, searchQuery);
    if (viewMode === 'policies') return buildPolicyNodes(demoTopology, searchQuery);
    return [];
  }, [viewMode, searchQuery]);

  const edges = useMemo(() => {
    if (viewMode === 'topology') return buildTopologyEdges(demoTopology, searchQuery);
    if (viewMode === 'policies') return buildPolicyEdges(demoTopology, searchQuery);
    return [];
  }, [viewMode, searchQuery]);

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
    navigator.clipboard.writeText(generateTerraform(demoTopology));
    setTerraformCopied(true);
    setTimeout(() => setTerraformCopied(false), 2000);
  };

  const handleDownloadTerraform = () => {
    downloadTerraform(demoTopology);
  };

  return (
    <div className="flex h-full w-full">
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
            {/* Search */}
            <div className="relative hidden md:block">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-1.5 rounded-md text-xs w-48 border outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-input-bg)',
                  borderColor: 'var(--color-input-border)',
                  color: 'var(--color-text-primary)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
              />
            </div>

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
              <span className="hidden sm:inline">TF Export</span>
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

            <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] pl-1">
              <Info size={14} />
              <span className="text-[10px] hidden lg:inline">Demo Data</span>
            </div>
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
            <TrafficFlowPanel topology={demoTopology} filter={searchQuery} />
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={setReactFlowInstance}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color={theme === 'dark' ? '#2a2d3a' : '#dee2e6'} gap={20} size={1} />
              <Controls />
              <MiniMap
                nodeColor={(node) => {
                  if (node.hidden) return 'transparent';
                  if (node.type === 'cloudRegion') return '#3b82f6';
                  if (node.type === 'vpc') return '#06b6d4';
                  if (node.type === 'gateway') {
                    const type = (node.data as any)?.type;
                    if (type === 'dcf') return '#e4002b';
                    if (type === 'transit') return '#3b82f6';
                    if (type === 'egress') return '#f59e0b';
                    return '#8b5cf6';
                  }
                  if (node.type === 'smartGroup') return (node.data as any)?.color || '#666';
                  return '#666';
                }}
                maskColor={theme === 'dark' ? 'rgba(15, 17, 23, 0.7)' : 'rgba(248, 249, 250, 0.7)'}
                className="!bg-[var(--color-surface-raised)] !border-[var(--color-border-subtle)]"
              />
              <Panel position="top-left" className="m-4">
                <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-xs shadow-lg" style={{ color: 'var(--color-text-muted)' }}>
                  <div className="font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Legend</div>
                  {viewMode === 'topology' ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Cloud Region</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#06b6d4]" /> VPC / VNet</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#e4002b]" /> DCF Gateway</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Egress Gateway</div>
                      <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#8b5cf6]" /> Transit / Spoke</div>
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
        <PolicyMatrix topology={demoTopology} />
      ) : (
        <InspectorPanel
          topology={demoTopology}
          selectedNodeId={selectedNodeId}
          selectedNodeType={selectedNodeType}
          onClose={() => { setSelectedNodeId(null); setSelectedNodeType(null); }}
        />
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
                {generateTerraform(demoTopology)}
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
