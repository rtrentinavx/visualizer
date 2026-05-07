import { useState, useCallback, useEffect } from 'react';
import {
  LayoutGrid,
  Activity,
  Search,
  Sun,
  Moon,
  HelpCircle,
  FileCode,
  CloudUpload,
  CloudDownload,
  Check,
  Plus,
  X,
  GitGraph,
  ShieldAlert,
  Bot,
  Sparkles,
  FlaskConical,
  Upload,
} from 'lucide-react';
import type { DcfPolicyModel, DcfPolicy } from './types/dcf';

import { decryptTopology, saveTopologyStorage } from './lib/cryptoStorage';
import { saveTopologyToCloud, loadTopologyFromCloud } from './lib/upstashSync';
import { generateTerraform, downloadTerraform } from './lib/terraformExport';
import { downloadTopologyJSON } from './lib/importExport';
import { evaluateTopology } from './lib/policyEvaluator';
import { loadAISettings, saveAISettings, getDefaultAISettings } from './lib/ai/storage';
import type { AISettings } from './lib/ai/types';
import { useTheme } from './lib/useTheme';
import PolicyMatrix from './components/panels/PolicyMatrix';

import PolicyGraph from './components/panels/PolicyGraph';
import InspectorPanel from './components/panels/InspectorPanel';
import EvaluatorPanel from './components/panels/EvaluatorPanel';
import AISettingsPanel from './components/panels/AISettingsPanel';
import AIChatPanel from './components/panels/AIChatPanel';
import ImportPanel from './components/panels/ImportPanel';
import PolicySimulator from './components/panels/PolicySimulator';
import TrafficFlowPanel from './components/panels/TrafficFlowPanel';

type ViewMode = 'matrix' | 'graph' | 'traffic' | 'simulator';

interface SelectedItem {
  type: 'policy' | 'smartGroup' | 'webGroup' | 'threatGroup' | 'geoGroup';
  id: string;
  srcId?: string;
  dstId?: string;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [topology, setTopology] = useState<DcfPolicyModel>({
    smartGroups: [{ id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any', workloadCount: 0 }],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  });
  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState<{ srcId: string; dstId: string } | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'loading' | 'error'>('idle');
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showTerraformModal, setShowTerraformModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [showEvaluator, setShowEvaluator] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(getDefaultAISettings);

  // Load AI settings on mount
  useEffect(() => {
    loadAISettings().then((saved) => {
      if (saved) setAISettings(saved);
    }).catch(() => {});
  }, []);

  // Load encrypted topology on mount
  useEffect(() => {
    let cancelled = false;
    decryptTopology<DcfPolicyModel>().then((saved) => {
      if (cancelled) return;
      if (saved) {
        setTopology(saved);
      } else {
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

  // Auto-save to encrypted localStorage
  useEffect(() => {
    if (!storageReady) return;
    const timer = setTimeout(() => {
      saveTopologyStorage(topology).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [topology, storageReady]);

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedCell(null);
    setSelectedItem(null);
  };

  const handleSelectCell = useCallback((srcId: string, dstId: string) => {
    setSelectedCell({ srcId, dstId });
    setSelectedCell(null);
    setSelectedItem(null);
  }, []);

  const handleSelectPolicy = useCallback((policyId: string | null, srcId?: string, dstId?: string) => {
    if (policyId) {
      setSelectedItem({ type: 'policy', id: policyId, srcId, dstId });
    } else {
      setSelectedItem(null);
    }
  }, []);

  const handleUpdateItem = useCallback((itemType: string, itemId: string, data: Record<string, unknown>) => {
    setTopology((prev) => {
      switch (itemType) {
        case 'smartGroup': {
          if (itemId === '__new__') {
            const newGroup = {
              id: `sg-${Date.now()}`,
              name: 'New Smart Group',
              color: '#3b82f6',
              criteria: [],
              matchType: 'any' as const,
              workloadCount: 0,
              ...data,
            };
            return { ...prev, smartGroups: [...prev.smartGroups, newGroup as typeof prev.smartGroups[0]] };
          }
          return {
            ...prev,
            smartGroups: prev.smartGroups.map((g) => (g.id === itemId ? { ...g, ...data } as typeof g : g)),
          };
        }
        case 'webGroup': {
          if (itemId === '__new__') {
            const newGroup = { id: `wg-${Date.now()}`, name: 'New Web Group', fqdns: [], ...data };
            return { ...prev, webGroups: [...prev.webGroups, newGroup as typeof prev.webGroups[0]] };
          }
          return {
            ...prev,
            webGroups: prev.webGroups.map((g) => (g.id === itemId ? { ...g, ...data } as typeof g : g)),
          };
        }
        case 'threatGroup': {
          if (itemId === '__new__') {
            const newGroup = { id: `tg-${Date.now()}`, name: 'New Threat Group', category: 'custom' as const, entryCount: 0, ...data };
            return { ...prev, threatGroups: [...prev.threatGroups, newGroup as typeof prev.threatGroups[0]] };
          }
          return {
            ...prev,
            threatGroups: prev.threatGroups.map((g) => (g.id === itemId ? { ...g, ...data } as typeof g : g)),
          };
        }
        case 'geoGroup': {
          if (itemId === '__new__') {
            const newGroup = { id: `gg-${Date.now()}`, name: 'New Geo Group', countries: [], ...data };
            return { ...prev, geoGroups: [...prev.geoGroups, newGroup as typeof prev.geoGroups[0]] };
          }
          return {
            ...prev,
            geoGroups: prev.geoGroups.map((g) => (g.id === itemId ? { ...g, ...data } as typeof g : g)),
          };
        }
        case 'policy':
          if (itemId === '__new__') {
            const maxPriority = prev.policies.length > 0 ? Math.max(...prev.policies.map((p) => p.priority)) : 0;
            const newPolicy: DcfPolicy = {
              id: `pol-${Date.now()}`,
              name: 'New Policy',
              priority: maxPriority + 10,
              srcGroupId: (data.srcGroupId as string) || 'sg-any',
              dstGroupId: (data.dstGroupId as string) || 'sg-any',
              action: 'allow',
              direction: 'any',
              protocol: 'tcp',
              logging: false,
              ...data,
            };
            return { ...prev, policies: [...prev.policies, newPolicy] };
          }
          return {
            ...prev,
            policies: prev.policies.map((p) => (p.id === itemId ? { ...p, ...data } as DcfPolicy : p)),
          };
        default:
          return prev;
      }
    });
  }, []);

  const handleDeleteItem = useCallback((itemType: string, itemId: string) => {
    setTopology((prev) => {
      switch (itemType) {
        case 'smartGroup':
          return {
            ...prev,
            smartGroups: prev.smartGroups.filter((g) => g.id !== itemId),
            policies: prev.policies.filter((p) => p.srcGroupId !== itemId && p.dstGroupId !== itemId),
          };
        case 'webGroup':
          return {
            ...prev,
            webGroups: prev.webGroups.filter((g) => g.id !== itemId),
            policies: prev.policies.map((p) => ({ ...p, webGroupIds: p.webGroupIds?.filter((id) => id !== itemId) })),
          };
        case 'threatGroup':
          return {
            ...prev,
            threatGroups: prev.threatGroups.filter((g) => g.id !== itemId),
            policies: prev.policies.map((p) => (p.threatGroup === itemId ? { ...p, threatGroup: undefined } : p)),
          };
        case 'geoGroup':
          return {
            ...prev,
            geoGroups: prev.geoGroups.filter((g) => g.id !== itemId),
            policies: prev.policies.map((p) => (p.geoGroup === itemId ? { ...p, geoGroup: undefined } : p)),
          };
        case 'policy':
          return { ...prev, policies: prev.policies.filter((p) => p.id !== itemId) };
        default:
          return prev;
      }
    });
    setSelectedItem(null);
  }, []);

  const handleCreateItem = useCallback((itemType: string, data: Record<string, unknown>) => {
    const id = `${itemType}-${Date.now()}`;
    setTopology((prev) => {
      switch (itemType) {
        case 'smartGroup':
          return {
            ...prev,
            smartGroups: [...prev.smartGroups, { id, name: 'New Smart Group', color: '#3b82f6', criteria: [], matchType: 'any', workloadCount: 0, ...data } as typeof prev.smartGroups[0]],
          };
        case 'webGroup':
          return {
            ...prev,
            webGroups: [...prev.webGroups, { id, name: 'New Web Group', fqdns: [], ...data } as typeof prev.webGroups[0]],
          };
        case 'threatGroup':
          return {
            ...prev,
            threatGroups: [...prev.threatGroups, { id, name: 'New Threat Group', category: 'custom', entryCount: 0, ...data } as typeof prev.threatGroups[0]],
          };
        case 'geoGroup':
          return {
            ...prev,
            geoGroups: [...prev.geoGroups, { id, name: 'New Geo Group', countries: [], ...data } as typeof prev.geoGroups[0]],
          };
        default:
          return prev;
      }
    });
    // After creating, select the new item for editing
    setSelectedCell(null);
    setSelectedItem({ type: itemType as SelectedItem['type'], id });
  }, []);

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
        setTopology(saved);
        setSelectedItem(null);
      }
      setCloudSyncStatus('idle');
    } catch {
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus('idle'), 3000);
    }
  };

  const handleCopyTerraform = () => {
    const content = generateTerraform(topology);
    navigator.clipboard.writeText(content).then(() => {
      setShowTerraformModal(true);
      setTimeout(() => setShowTerraformModal(false), 2000);
    });
  };

  const handleClearAll = () => {
    setConfirmModal({
      open: true,
      title: 'Clear All',
      message: 'This will remove all groups and policies. This action cannot be undone.',
      onConfirm: () => {
        setTopology({
          smartGroups: [{ id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any', workloadCount: 0 }],
          webGroups: [],
          threatGroups: [],
          geoGroups: [],
          policies: [],
          flows: [],
        });
        setSelectedItem(null);
        setConfirmModal((prev) => ({ ...prev, open: false }));
      },
    });
  };

  return (
    <div className="flex h-full w-full">
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="min-h-14 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex items-center justify-between px-4 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <img src="/logo-header.png" alt="DCF Visualizer" className="h-14 w-auto rounded-md" />
              <h1 className="text-sm font-bold text-[var(--color-text-primary)] tracking-wide hidden sm:inline">visualizer</h1>
            </div>
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-1 shrink-0" />
            <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5 border border-[var(--color-border-subtle)] shrink-0">
              <button
                onClick={() => handleViewChange('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'matrix'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <LayoutGrid size={14} />
                <span className="hidden sm:inline">Matrix</span>
              </button>
              <button
                onClick={() => handleViewChange('graph')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'graph'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <GitGraph size={14} />
                <span className="hidden sm:inline">Graph</span>
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
              <button
                onClick={() => handleViewChange('simulator')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === 'simulator'
                    ? 'bg-[var(--color-aviatrix)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
                }`}
              >
                <FlaskConical size={14} />
                <span className="hidden sm:inline">Simulator</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Search */}
            <div className="relative hidden xl:block">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-1.5 rounded-md text-xs w-36 border outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-input-bg)',
                  borderColor: 'var(--color-input-border)',
                  color: 'var(--color-text-primary)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
              />
            </div>

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

            {/* Add Group */}
            <button
              onClick={() => handleCreateItem('smartGroup', {})}
              className="p-1.5 rounded-md border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Add Group"
            >
              <Plus size={14} />
            </button>

            {/* Clear All */}
            <button
              onClick={handleClearAll}
              className="p-1.5 rounded-md border transition-colors hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Clear All"
            >
              <X size={14} />
            </button>

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

            {/* Cloud Save */}
            <button
              onClick={handleSaveToCloud}
              disabled={cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading'}
              className="p-1.5 rounded-md border transition-colors disabled:opacity-50 hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)'; }}
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
              className="p-1.5 rounded-md border transition-colors disabled:opacity-50 hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Load from Cloud"
            >
              {cloudSyncStatus === 'loading' ? (
                <span className="w-3.5 h-3.5 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <CloudDownload size={14} />
              )}
            </button>

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

            {/* Import */}
            <button
              onClick={() => setShowImportModal(true)}
              className="p-1.5 rounded-md border transition-colors hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Import Topology"
            >
              <Upload size={14} />
            </button>

            {/* JSON Export */}
            <button
              onClick={() => downloadTopologyJSON(topology)}
              className="p-1.5 rounded-md border transition-colors hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Export JSON"
            >
              <FileCode size={14} />
            </button>

            {/* Terraform Export */}
            <button
              onClick={() => setShowTerraformModal(true)}
              className="p-1.5 rounded-md border transition-colors hidden md:flex"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Export Terraform"
            >
              <FileCode size={14} />
            </button>

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

            {/* Evaluator */}
            <button
              onClick={() => setShowEvaluator(true)}
              className="p-1.5 rounded-md border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="Policy Evaluator"
            >
              <ShieldAlert size={14} />
            </button>

            {/* AI Settings */}
            <button
              onClick={() => setShowAISettings(true)}
              className="p-1.5 rounded-md border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="AI Settings"
            >
              <Bot size={14} />
            </button>

            {/* Ask AI */}
            {aiSettings.activeProfileId && (
              <button
                onClick={() => setShowAIChat(true)}
                className="p-1.5 rounded-md border transition-colors"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                title="Ask AI"
              >
                <Sparkles size={14} />
              </button>
            )}

            {/* Divider */}
            <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5" />

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-md border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* About */}
            <button
              onClick={() => setShowAboutModal(true)}
              className="p-1.5 rounded-md border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
              title="About"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        </div>

        {/* Mobile Search */}
        <div className="lg:hidden px-4 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search groups, policies, protocols..."
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
        <div className="flex-1 overflow-hidden">
          {viewMode === 'matrix' ? (
            <PolicyMatrix
              topology={topology}
              searchQuery={searchQuery}
              selectedCell={selectedCell}
              onSelectCell={handleSelectCell}
              onSelectGroup={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
              onSelectPolicy={handleSelectPolicy}
            />
          ) : viewMode === 'graph' ? (
            <PolicyGraph
              topology={topology}
              onSelectNode={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
              onSelectPolicy={(policyId) => setSelectedItem({ type: 'policy', id: policyId })}
              onCreatePolicy={(srcId, dstId) => {
                setSelectedCell({ srcId, dstId });
                setSelectedItem({ type: 'policy', id: '__new__', srcId, dstId });
              }}
              onSelectGroup={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
            />
          ) : viewMode === 'simulator' ? (
            <PolicySimulator topology={topology} />
          ) : viewMode === 'traffic' ? (
            <TrafficFlowPanel
              topology={topology}
              filter={searchQuery}
              onCreateFlow={(flow) => {
                const newFlow = { ...flow, id: `flow-${Date.now()}` };
                setTopology((prev) => ({ ...prev, flows: [...prev.flows, newFlow] }));
              }}
              onUpdateFlow={(id, data) => {
                setTopology((prev) => ({
                  ...prev,
                  flows: prev.flows.map((f) => (f.id === id ? { ...f, ...data } : f)),
                }));
              }}
              onDeleteFlow={(id) => {
                setTopology((prev) => ({ ...prev, flows: prev.flows.filter((f) => f.id !== id) }));
              }}
            />
          ) : (
            <PolicyMatrix
              topology={topology}
              searchQuery={searchQuery}
              selectedCell={selectedCell}
              onSelectCell={handleSelectCell}
              onSelectGroup={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
              onSelectPolicy={handleSelectPolicy}
            />
          )}
        </div>
      </div>

      {/* Right Sidebar - Inspector */}
      <InspectorPanel
        topology={topology}
        selectedCell={selectedCell}
        selectedItem={selectedItem}
        aiProfile={aiSettings.profiles.find((p) => p.id === aiSettings.activeProfileId)}
        onClose={() => {
          setSelectedCell(null);
          setSelectedItem(null);
        }}
        onUpdateItem={handleUpdateItem}
        onDeleteItem={handleDeleteItem}
        onCreateItem={handleCreateItem}
        onSelectPolicy={handleSelectPolicy}
      />

      {/* Terraform Export Modal */}
      {showTerraformModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Terraform Export</h2>
              <button onClick={() => setShowTerraformModal(false)} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--color-text-secondary)' }}>
                {generateTerraform(topology)}
              </pre>
            </div>
            <div className="p-4 border-t border-[var(--color-border-subtle)] flex items-center gap-3">
              <button
                onClick={handleCopyTerraform}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <FileCode size={13} />
                Copy to Clipboard
              </button>
              <button
                onClick={() => downloadTerraform(topology)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
              >
                Download .tf
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">About DCF Visualizer</h2>
              <button onClick={() => setShowAboutModal(false)} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <p>
                The <strong>DCF Visualizer</strong> is an interactive design tool for Aviatrix Distributed Cloud Firewall policies.
                It lets you model SmartGroups, WebGroups, ThreatGroups, GeoGroups, and the policies that govern traffic between them.
              </p>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Current Features</h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>Policy Matrix with priority-aware cell rendering</li>
                  <li>Traffic flow visualization</li>
                  <li>Full policy editor with direction, protocol, ports, decrypt, threat/geo groups, web groups</li>
                  <li>Terraform export for Aviatrix provider</li>
                  <li>Encrypted localStorage persistence</li>
                  <li>Cloud sync via Upstash Redis</li>
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Security</h3>
                <p className="text-xs">
                  Topology data is encrypted with AES-GCM before storage. No data leaves your browser unless you explicitly use cloud sync.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="w-full max-w-sm rounded-xl border shadow-2xl p-5"
            style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{confirmModal.title}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">{confirmModal.message}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderColor: 'var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Policy Evaluator */}
      {showEvaluator && (
        <EvaluatorPanel
          topology={topology}
          findings={evaluateTopology(topology)}
          aiProfile={aiSettings.profiles.find((p) => p.id === aiSettings.activeProfileId)}
          onClose={() => setShowEvaluator(false)}
          onSelectPolicy={(policyId) => {
            setShowEvaluator(false);
            setSelectedItem({ type: 'policy', id: policyId });
          }}
          onSelectGroup={(groupId) => {
            setShowEvaluator(false);
            setSelectedItem({ type: 'smartGroup', id: groupId });
          }}
          onApplyFix={(finding) => {
            // Apply simple fixes automatically
            if (finding.id.startsWith('shadow-')) {
              const shadowedId = finding.affectedPolicyIds?.[0];
              if (shadowedId) {
                setTopology((prev) => ({ ...prev, policies: prev.policies.filter((p) => p.id !== shadowedId) }));
              }
            } else if (finding.id.startsWith('missing-deny')) {
              const maxPriority = topology.policies.length > 0
                ? Math.max(...topology.policies.map((p) => p.priority))
                : 0;
              const newPolicy: DcfPolicy = {
                id: `pol-${Date.now()}`,
                name: 'Catch-All Deny',
                priority: maxPriority + 10,
                srcGroupId: 'sg-any',
                dstGroupId: 'sg-any',
                action: 'deny',
                direction: 'any',
                protocol: 'any',
                logging: true,
              };
              setTopology((prev) => ({ ...prev, policies: [...prev.policies, newPolicy] }));
            } else if (finding.id.startsWith('unused-')) {
              const groupId = finding.affectedGroupIds?.[0];
              if (groupId) {
                setTopology((prev) => ({
                  ...prev,
                  smartGroups: prev.smartGroups.filter((g) => g.id !== groupId),
                }));
              }
            } else if (finding.id.startsWith('missing-log-')) {
              const policyId = finding.affectedPolicyIds?.[0];
              if (policyId) {
                setTopology((prev) => ({
                  ...prev,
                  policies: prev.policies.map((p) => (p.id === policyId ? { ...p, logging: true } as DcfPolicy : p)),
                }));
              }
            } else {
              // For complex fixes, just open the affected item
              if (finding.affectedPolicyIds?.[0]) {
                setSelectedItem({ type: 'policy', id: finding.affectedPolicyIds[0] });
              } else if (finding.affectedGroupIds?.[0]) {
                setSelectedItem({ type: 'smartGroup', id: finding.affectedGroupIds[0] });
              }
            }
          }}
        />
      )}

      {/* AI Settings */}
      {showAISettings && (
        <AISettingsPanel
          settings={aiSettings}
          onSave={(settings) => {
            setAISettings(settings);
            saveAISettings(settings).catch(() => {});
            setShowAISettings(false);
          }}
          onClose={() => setShowAISettings(false)}
        />
      )}

      {/* AI Chat */}
      {showAIChat && aiSettings.activeProfileId && (
        <AIChatPanel
          topology={topology}
          profile={aiSettings.profiles.find((p) => p.id === aiSettings.activeProfileId)!}
          onClose={() => setShowAIChat(false)}
          onApplyPolicy={(data) => {
            // Resolve group names to IDs
            const srcName = String(data.srcGroupName || '');
            const dstName = String(data.dstGroupName || '');
            const srcGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === srcName.toLowerCase());
            const dstGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === dstName.toLowerCase());

            if (!srcGroup || !dstGroup) {
              alert(`Groups not found: ${srcName} → ${dstName}. Create them first.`);
              return;
            }

            const newPolicy: DcfPolicy = {
              id: `pol-${Date.now()}`,
              name: String(data.name || 'AI Policy'),
              priority: Number(data.priority) || 100,
              srcGroupId: srcGroup.id,
              dstGroupId: dstGroup.id,
              action: (String(data.action || 'allow') as 'allow' | 'deny' | 'learned'),
              direction: (String(data.direction || 'any') as 'inbound' | 'outbound' | 'any'),
              protocol: (String(data.protocol || 'tcp') as 'tcp' | 'udp' | 'icmp' | 'any'),
              ports: data.ports ? String(data.ports) : undefined,
              logging: Boolean(data.logging),
              decrypt: Boolean(data.decrypt),
            };

            setTopology((prev) => ({ ...prev, policies: [...prev.policies, newPolicy] }));
            setShowAIChat(false);
            setSelectedItem({ type: 'policy', id: newPolicy.id });
          }}
        />
      )}

      {/* Import Panel */}
      {showImportModal && (
        <ImportPanel
          onImport={(imported) => {
            setTopology(imported);
            saveTopologyStorage(imported).catch(() => {});
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
