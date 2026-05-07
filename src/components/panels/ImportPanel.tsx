import { useState } from 'react';
import { X, Upload, FileCode, FileJson, AlertTriangle, CheckCircle } from 'lucide-react';
import { importTopologyJSON, importTerraformHCL } from '../../lib/importExport';
import type { DcfPolicyModel } from '../../types/dcf';

interface ImportPanelProps {
  onImport: (topology: DcfPolicyModel) => void;
  onClose: () => void;
}

type ImportTab = 'json' | 'terraform';

export default function ImportPanel({ onImport, onClose }: ImportPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('json');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<DcfPolicyModel | null>(null);

  const handleParse = () => {
    setError(null);
    setSuccess(null);
    setPreview(null);

    if (!input.trim()) {
      setError('Paste some content to import.');
      return;
    }

    try {
      if (activeTab === 'json') {
        const topology = importTopologyJSON(input.trim());
        setPreview(topology);
        setSuccess(`Valid JSON topology: ${topology.smartGroups.length} groups, ${topology.policies.length} policies.`);
      } else {
        const topology = importTerraformHCL(input.trim());
        setPreview(topology);
        setSuccess(`Parsed Terraform HCL: ${topology.smartGroups.length - 1} groups imported, ${topology.policies.length} policies.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse input');
    }
  };

  const handleImport = () => {
    if (!preview) return;
    onImport(preview);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Import Topology</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Import from JSON or Terraform HCL</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => { setActiveTab('json'); setError(null); setSuccess(null); setPreview(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'json'
                ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <FileJson size={14} />
            JSON
          </button>
          <button
            onClick={() => { setActiveTab('terraform'); setError(null); setSuccess(null); setPreview(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'terraform'
                ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <FileCode size={14} />
            Terraform HCL
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'json' && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Paste a JSON export from this tool or any valid DCF topology JSON.
            </p>
          )}
          {activeTab === 'terraform' && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Paste Terraform <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.tf</code> content.
              Supports <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">aviatrix_smart_group</code> and
              <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">aviatrix_distributed_firewalling_policy_list</code> resources.
            </p>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeTab === 'json' ? '{\n  "smartGroups": [...],\n  "policies": [...]\n}' : 'resource "aviatrix_smart_group" "web" {\n  ...\n}'}
            className="w-full h-48 px-3 py-2 rounded text-xs border outline-none font-mono resize-none"
            style={{
              backgroundColor: 'var(--color-input-bg)',
              borderColor: 'var(--color-input-border)',
              color: 'var(--color-text-primary)',
            }}
          />

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-red-500/10 border-red-500/30">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-green-500/10 border-green-500/30">
              <CheckCircle size={14} className="text-green-400 shrink-0 mt-0.5" />
              <p className="text-xs text-green-400">{success}</p>
            </div>
          )}

          {preview && (
            <div className="p-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Preview</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-[var(--color-text-muted)]">Smart Groups</div>
                <div className="text-[var(--color-text-primary)] font-medium">{preview.smartGroups.length}</div>
                <div className="text-[var(--color-text-muted)]">Policies</div>
                <div className="text-[var(--color-text-primary)] font-medium">{preview.policies.length}</div>
                <div className="text-[var(--color-text-muted)]">Web Groups</div>
                <div className="text-[var(--color-text-primary)] font-medium">{preview.webGroups.length}</div>
                <div className="text-[var(--color-text-muted)]">Threat Groups</div>
                <div className="text-[var(--color-text-primary)] font-medium">{preview.threatGroups.length}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
          <button
            onClick={handleParse}
            className="px-4 py-1.5 rounded-md text-xs font-medium border transition-colors"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Preview
          </button>
          <button
            onClick={handleImport}
            disabled={!preview}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Upload size={13} />
            Import & Replace
          </button>
        </div>
      </div>
    </div>
  );
}
