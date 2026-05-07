import { useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  Activity,
  Plus,
  Trash2,
  Pencil,
  Upload,
  Download,
  ChevronDown,
  AlertTriangle,
  X,
} from 'lucide-react';
import type { DcfPolicyModel, TrafficFlow, Protocol, PolicyDirection } from '../../types/dcf';
import {
  downloadFlowsJSON,
  downloadFlowsCSV,
  importFlowsJSON,
  importFlowsCSV,
} from '../../lib/importExport';

interface TrafficFlowPanelProps {
  topology: DcfPolicyModel;
  filter?: string;
  onCreateFlow: (flow: Omit<TrafficFlow, 'id'>) => void;
  onUpdateFlow: (id: string, flow: Partial<TrafficFlow>) => void;
  onDeleteFlow: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

const emptyForm = {
  srcGroupId: '',
  dstGroupId: '',
  protocol: 'tcp' as Protocol,
  port: '',
  bytes: '',
  packets: '',
  allowed: true,
  direction: 'any' as PolicyDirection,
  timestamp: new Date().toISOString().slice(0, 16),
};

export default function TrafficFlowPanel({
  topology,
  filter = '',
  onCreateFlow,
  onUpdateFlow,
  onDeleteFlow,
}: TrafficFlowPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [importMode, setImportMode] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const f = filter.toLowerCase();
  const filteredFlows = topology.flows.filter((flow) => {
    if (!f) return true;
    const srcGroup = topology.smartGroups.find((g) => g.id === flow.srcGroupId);
    const dstGroup = topology.smartGroups.find((g) => g.id === flow.dstGroupId);
    return (
      srcGroup?.name.toLowerCase().includes(f) ||
      dstGroup?.name.toLowerCase().includes(f) ||
      flow.protocol.toLowerCase().includes(f) ||
      String(flow.port).includes(f)
    );
  });

  const allowedCount = filteredFlows.filter((f) => f.allowed).length;
  const deniedCount = filteredFlows.filter((f) => !f.allowed).length;
  const totalBytes = filteredFlows.reduce((sum, f) => sum + f.bytes, 0);

  const smartGroupOptions = topology.smartGroups.filter((g) => g.id !== 'sg-internet');

  const startEdit = (flow: TrafficFlow) => {
    setEditingId(flow.id);
    setForm({
      srcGroupId: flow.srcGroupId,
      dstGroupId: flow.dstGroupId,
      protocol: flow.protocol,
      port: String(flow.port),
      bytes: String(flow.bytes),
      packets: String(flow.packets),
      allowed: flow.allowed,
      direction: flow.direction || 'any',
      timestamp: flow.timestamp.slice(0, 16),
    });
    setShowForm(true);
    setImportMode(false);
  };

  const startNew = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
    setImportMode(false);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const submitForm = () => {
    if (!form.srcGroupId || !form.dstGroupId) return;
    const payload = {
      srcGroupId: form.srcGroupId,
      dstGroupId: form.dstGroupId,
      protocol: form.protocol,
      port: Number(form.port) || 0,
      bytes: Number(form.bytes) || 0,
      packets: Number(form.packets) || 0,
      allowed: form.allowed,
      direction: form.direction,
      timestamp: new Date(form.timestamp).toISOString(),
    };
    if (editingId) {
      onUpdateFlow(editingId, payload);
    } else {
      onCreateFlow(payload);
    }
    cancelForm();
  };

  const handleImport = () => {
    setImportError(null);
    if (!importText.trim()) return;
    try {
      let flows: TrafficFlow[];
      if (importText.trim().startsWith('[')) {
        flows = importFlowsJSON(importText.trim());
      } else {
        flows = importFlowsCSV(importText.trim());
      }
      for (const flow of flows) {
        onCreateFlow(flow);
      }
      setImportText('');
      setImportMode(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const updateField = <K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Traffic Flows</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Manually log and analyze traffic between groups</p>
          </div>
          <Activity size={18} className="text-[var(--color-accent-blue)]" />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-green-400">{allowedCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Allowed</div>
          </div>
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-red-400">{deniedCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Denied</div>
          </div>
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{formatBytes(totalBytes)}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Total</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-2 border-b border-[var(--color-border-subtle)] flex items-center gap-2 flex-wrap">
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white"
          style={{ backgroundColor: 'var(--color-aviatrix)' }}
        >
          <Plus size={13} />
          Add Flow
        </button>
        <button
          onClick={() => { setImportMode(!importMode); setShowForm(false); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
        >
          <Upload size={13} />
          Import
        </button>
        <button
          onClick={() => downloadFlowsJSON(topology.flows)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
        >
          <Download size={13} />
          JSON
        </button>
        <button
          onClick={() => downloadFlowsCSV(topology.flows, topology)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
        >
          <Download size={13} />
          CSV
        </button>
      </div>

      {/* Import Panel */}
      {importMode && (
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Import Flows</p>
            <button onClick={() => setImportMode(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              <X size={14} />
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)]">Paste JSON array or CSV (with headers).</p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`[{&quot;srcGroupId&quot;:&quot;sg-...&quot;, &quot;dstGroupId&quot;:&quot;sg-...&quot;, ...}]`}
            className="w-full h-24 px-2 py-1.5 rounded text-xs border outline-none font-mono resize-none"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
          />
          {importError && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400">
              <AlertTriangle size={12} />
              {importError}
            </div>
          )}
          <button
            onClick={handleImport}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            Import Flows
          </button>
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              {editingId ? 'Edit Flow' : 'New Flow'}
            </p>
            <button onClick={cancelForm} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Source */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Source</label>
              <div className="relative">
                <select
                  value={form.srcGroupId}
                  onChange={(e) => updateField('srcGroupId', e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                >
                  <option value="">Select...</option>
                  {smartGroupOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                  <option value="sg-any">Any</option>
                </select>
                <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
              </div>
            </div>
            {/* Destination */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Destination</label>
              <div className="relative">
                <select
                  value={form.dstGroupId}
                  onChange={(e) => updateField('dstGroupId', e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                >
                  <option value="">Select...</option>
                  {smartGroupOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                  <option value="sg-any">Any</option>
                </select>
                <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
              </div>
            </div>
            {/* Protocol */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Protocol</label>
              <div className="relative">
                <select
                  value={form.protocol}
                  onChange={(e) => updateField('protocol', e.target.value as Protocol)}
                  className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                  <option value="any">Any</option>
                </select>
                <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
              </div>
            </div>
            {/* Port */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => updateField('port', e.target.value)}
                className="w-full px-2 py-1 rounded text-xs border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
            {/* Bytes */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Bytes</label>
              <input
                type="number"
                value={form.bytes}
                onChange={(e) => updateField('bytes', e.target.value)}
                className="w-full px-2 py-1 rounded text-xs border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
            {/* Packets */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Packets</label>
              <input
                type="number"
                value={form.packets}
                onChange={(e) => updateField('packets', e.target.value)}
                className="w-full px-2 py-1 rounded text-xs border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
            {/* Timestamp */}
            <div>
              <label className="block text-[10px] text-[var(--color-text-muted)] mb-0.5">Timestamp</label>
              <input
                type="datetime-local"
                value={form.timestamp}
                onChange={(e) => updateField('timestamp', e.target.value)}
                className="w-full px-2 py-1 rounded text-xs border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
            {/* Allowed */}
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allowed}
                  onChange={(e) => updateField('allowed', e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-[var(--color-text-secondary)]">Allowed</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={submitForm}
              disabled={!form.srcGroupId || !form.dstGroupId}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              {editingId ? 'Update Flow' : 'Add Flow'}
            </button>
            <button
              onClick={cancelForm}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-[var(--color-text-secondary)] border"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Flow List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredFlows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
              <Activity size={24} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No traffic flows yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">
              Click <strong>Add Flow</strong> to manually log traffic, or <strong>Import</strong> to bulk-load from JSON/CSV.
            </p>
          </div>
        ) : (
          filteredFlows.map((flow) => (
            <FlowRow
              key={flow.id}
              flow={flow}
              topology={topology}
              onEdit={() => startEdit(flow)}
              onDelete={() => onDeleteFlow(flow.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FlowRow({
  flow,
  topology,
  onEdit,
  onDelete,
}: {
  flow: TrafficFlow;
  topology: DcfPolicyModel;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const srcGroup = topology.smartGroups.find((g) => g.id === flow.srcGroupId);
  const dstGroup = topology.smartGroups.find((g) => g.id === flow.dstGroupId);

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded border ${flow.allowed ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
      <div className="flex items-center gap-2 min-w-[120px]">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: srcGroup?.color || '#666' }} />
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{srcGroup?.name || flow.srcGroupId}</span>
      </div>
      <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
        <ArrowRightLeft size={12} />
        <span className="text-[10px] font-mono uppercase">{flow.protocol}</span>
        <span className="text-[10px] font-mono">:{flow.port}</span>
      </div>
      <div className="flex items-center gap-2 min-w-[120px] justify-end">
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{dstGroup?.name || flow.dstGroupId}</span>
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dstGroup?.color || '#666' }} />
      </div>
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] ml-2">
        {formatTimestamp(flow.timestamp)}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-[10px] text-[var(--color-text-muted)]">{formatBytes(flow.bytes)}</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">{flow.packets} pkts</div>
        </div>
        {flow.allowed ? (
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={16} className="text-red-400 shrink-0" />
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
