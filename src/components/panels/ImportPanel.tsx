import { useEffect, useRef, useState } from 'react';
import { X, Upload, FileCode, FileArchive, AlertTriangle, CheckCircle, Plug, Loader2 } from 'lucide-react';
import { unzipSync, strFromU8 } from 'fflate';
import { importTerraformHCLWithReport } from '../../lib/importExport';
import type { DcfPolicyModel } from '../../types/dcf';
import { loadAviatrixSettings, getActiveConnection, getConnectionStatus, isApiConnection, isMcpConnection } from '../../lib/aviatrix/storage';
import type { AviatrixConnection } from '../../lib/aviatrix/types';
import { mapTopology } from '../../lib/aviatrix/mapTopology';

interface ImportPanelProps {
  onImport: (topology: DcfPolicyModel) => void;
  onClose: () => void;
}

type ImportTab = 'terraform' | 'zip' | 'live';

interface ZipResult {
  fileCount: number;
  fileNames: string[];
  topology: DcfPolicyModel;
  unresolvedRefs: string[];
}

const TF_EXTENSIONS = /\.(tf|tf\.json)$/i;

// Anything under a `.terraform/` directory (cached modules + providers) is build
// output, not source. Skip it so we don't waste cycles parsing vendored copies.
function isVendoredPath(name: string): boolean {
  return name.includes('/.terraform/') || name.startsWith('.terraform/');
}

function extractZip(buffer: Uint8Array): ZipResult {
  const entries = unzipSync(buffer);
  const tfNames = Object.keys(entries).filter(
    (name) => TF_EXTENSIONS.test(name) && !isVendoredPath(name),
  );
  if (tfNames.length === 0) {
    throw new Error('No .tf files found in this zip (looked for *.tf, ignored .terraform/ vendored content).');
  }
  // Concatenate with `# === filename ===` markers between files. Our HCL
  // tokenizer strips `#` comments so they don't reach the parser.
  const hcl = tfNames
    .map((name) => `# === ${name} ===\n${strFromU8(entries[name]!)}`)
    .join('\n\n');
  const { topology, unresolvedRefs } = importTerraformHCLWithReport(hcl);
  return { fileCount: tfNames.length, fileNames: tfNames, topology, unresolvedRefs };
}

export default function ImportPanel({ onImport, onClose }: ImportPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('terraform');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<DcfPolicyModel | null>(null);
  const [zipResult, setZipResult] = useState<ZipResult | null>(null);
  const [zipFileName, setZipFileName] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Aviatrix Live state
  const [liveConnection, setLiveConnection] = useState<AviatrixConnection | null>(null);
  const [isFetchingLive, setIsFetchingLive] = useState(false);
  const [liveWarnings, setLiveWarnings] = useState<string[]>([]);
  // Refs in policies that couldn't be matched back to an imported group. The
  // most common cause of "Unused SmartGroup" false-positives is the import
  // dropping references silently; surfacing them here makes the cause obvious.
  const [unresolvedRefs, setUnresolvedRefs] = useState<string[]>([]);

  useEffect(() => {
    loadAviatrixSettings()
      .then((s) => { if (s) setLiveConnection(getActiveConnection(s)); })
      .catch(() => {});
  }, []);

  const resetState = () => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    setZipResult(null);
    setZipFileName(null);
    setUnresolvedRefs([]);
  };

  const switchTab = (tab: ImportTab) => {
    setActiveTab(tab);
    resetState();
  };

  const handleParse = () => {
    resetState();
    if (!input.trim()) {
      setError('Paste some content to import.');
      return;
    }
    try {
      if (activeTab === 'terraform') {
        const { topology, unresolvedRefs: refs } = importTerraformHCLWithReport(input.trim());
        setPreview(topology);
        setUnresolvedRefs(refs);
        setSuccess(`Parsed Terraform HCL: ${topology.smartGroups.length - 1} groups imported, ${topology.policies.length} policies.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse input');
    }
  };

  const handleZipFile = async (file: File) => {
    resetState();
    setZipFileName(file.name);
    setIsExtracting(true);
    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('Zip file is larger than 50 MB. Extract locally and paste the .tf contents instead.');
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const result = extractZip(buffer);
      setZipResult(result);
      setPreview(result.topology);
      setUnresolvedRefs(result.unresolvedRefs);
      const nonInternetGroups = result.topology.smartGroups.length - 1;
      setSuccess(
        `Extracted ${result.fileCount} .tf file${result.fileCount === 1 ? '' : 's'} → ` +
          `${nonInternetGroups} SmartGroup${nonInternetGroups === 1 ? '' : 's'}, ` +
          `${result.topology.policies.length} polic${result.topology.policies.length === 1 ? 'y' : 'ies'}, ` +
          `${result.topology.webGroups.length} WebGroup${result.topology.webGroups.length === 1 ? '' : 's'}. ` +
          `Non-Aviatrix resources were ignored.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract zip');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleZipFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleZipFile(file);
  };

  const handleFetchLive = async () => {
    resetState();
    setLiveWarnings([]);
    if (!liveConnection) {
      setError('No active Aviatrix connection. Configure one in AI Settings → Aviatrix Live Connection.');
      return;
    }
    if (isMcpConnection(liveConnection) && !liveConnection.accessToken) {
      setError('MCP connection is not authenticated. Go to AI Settings → Aviatrix Live Connection and click Connect.');
      return;
    }
    setIsFetchingLive(true);
    try {
      let endpoint: string;
      let body: Record<string, string>;
      if (isApiConnection(liveConnection)) {
        endpoint = '/api/aviatrix/topology-api';
        body = { controllerBaseUrl: liveConnection.controllerBaseUrl, username: liveConnection.username, password: liveConnection.password };
      } else {
        endpoint = '/api/aviatrix/topology';
        body = { baseUrl: liveConnection.mcpBaseUrl, accessToken: liveConnection.accessToken! };
      }
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `HTTP ${r.status}`);
      }
      const data = await r.json() as {
        raw: { smartGroups: unknown[]; webGroups: unknown[]; threatGroups: unknown[]; geoGroups: unknown[]; policies: unknown[] };
        warnings: string[];
        apiVersion?: string;
      };
      const { topology, droppedCounts } = mapTopology(data.raw);
      setPreview(topology);
      setLiveWarnings(data.warnings || []);
      const nonInternetGroups = topology.smartGroups.filter((g) => g.id !== 'sg-internet').length;
      const droppedTotal = Object.values(droppedCounts).reduce((a, b) => a + b, 0);
      const viaLabel = data.apiVersion ? ` via ${data.apiVersion}` : '';
      setSuccess(
        `Fetched live${viaLabel}: ${nonInternetGroups} SmartGroups, ${topology.webGroups.length} WebGroups, ` +
          `${topology.threatGroups.length} ThreatGroups, ${topology.geoGroups.length} GeoGroups, ` +
          `${topology.policies.length} policies` +
          (droppedTotal > 0 ? ` (${droppedTotal} entries couldn't be mapped)` : '') + '.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live fetch failed.');
    } finally {
      setIsFetchingLive(false);
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
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Import Topology</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Terraform paste · Terraform zip upload</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => switchTab('terraform')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'terraform'
                ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <FileCode size={14} />
            Terraform HCL
          </button>
          <button
            onClick={() => switchTab('zip')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'zip'
                ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <FileArchive size={14} />
            Terraform Zip
          </button>
          <button
            onClick={() => switchTab('live')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'live'
                ? 'border-[var(--color-accent-purple)] text-[var(--color-accent-purple)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            <Plug size={14} />
            Aviatrix Live
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'terraform' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Paste Terraform <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.tf</code> content.
                Supports <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">aviatrix_smart_group</code> and{' '}
                <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">aviatrix_distributed_firewalling_policy_list</code> resources.
              </p>
              <details className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                <summary className="px-3 py-2 text-[10px] font-medium text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)] select-none">
                  Seeing "Unused SmartGroup" warnings? Ask Aviatrix Support to run this
                </summary>
                <div className="px-3 pb-3 space-y-1.5">
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    Controller-emitted Terraform uses bare UUIDs for group references instead of names.
                    Ask support to provide the output of:
                  </p>
                  <pre className="text-[10px] font-mono p-2 rounded bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] overflow-x-auto select-all whitespace-pre-wrap break-all">{`cat /etc/localgateway/smgrp_resolver_smgrp_info | jq -r '.appDomainCfg | "\\(.name)||\\(.uuid)"' | column -t -s'||' | grep system`}</pre>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    This maps each SmartGroup name to its UUID so the importer can resolve references correctly.
                    Alternatively, use <strong>Aviatrix Live</strong> (REST API or MCP) for a full-fidelity import with no UUID ambiguity.
                  </p>
                </div>
              </details>
            </div>
          )}
          {activeTab === 'zip' && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Drop a zipped Terraform project. We extract every <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.tf</code> file
              (skipping <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.terraform/</code> vendored content)
              and pull only Aviatrix DCF resources. Non-DCF resources are silently ignored.
            </p>
          )}

          {activeTab === 'terraform' && (
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='resource "aviatrix_smart_group" "web" {\n  ...\n}'
              className="w-full h-48 px-3 py-2 rounded text-xs border outline-none font-mono resize-none"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: 'var(--color-input-border)',
                color: 'var(--color-text-primary)',
              }}
            />
          )}

          {activeTab === 'live' && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                Fetch SmartGroups, WebGroups, ThreatGroups, GeoGroups, and policies directly from your Aviatrix Controller.
                Configure a connection (MCP or REST API) in <strong>AI Settings → Aviatrix Live Connection</strong>.
              </p>
              {liveConnection ? (
                <div className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 space-y-1.5">
                  <div className="text-xs font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                    <Plug size={12} className="text-[var(--color-accent-purple)]" />
                    {liveConnection.name}
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400">
                      {isApiConnection(liveConnection) ? 'REST API' : 'MCP'}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">
                    {isApiConnection(liveConnection) ? liveConnection.controllerBaseUrl : liveConnection.mcpBaseUrl}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)]">
                    Status: <strong>{getConnectionStatus(liveConnection)}</strong>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--color-text-muted)] italic">No active connection. Configure one in AI Settings first.</p>
              )}
              <button
                onClick={handleFetchLive}
                disabled={isFetchingLive || !liveConnection || (() => {
                  const s = getConnectionStatus(liveConnection);
                  // API: allow fetch when configured or connected (credentials present).
                  // MCP: require a valid OAuth token ('connected').
                  return isApiConnection(liveConnection) ? s === 'disconnected' : s !== 'connected';
                })()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent-purple)' }}
              >
                {isFetchingLive ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                {isFetchingLive ? 'Fetching…' : 'Fetch from Controller'}
              </button>
              {liveWarnings.length > 0 && (
                <details className="text-[10px] text-amber-300">
                  <summary className="cursor-pointer flex items-center gap-1">
                    <AlertTriangle size={11} /> {liveWarnings.length} warning{liveWarnings.length === 1 ? '' : 's'} during fetch
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                    {liveWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {activeTab === 'zip' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors"
                style={{
                  borderColor: dragging ? 'var(--color-accent-blue)' : 'var(--color-border-subtle)',
                  backgroundColor: dragging ? 'var(--color-button-hover)' : 'var(--color-surface)',
                }}
              >
                <FileArchive size={28} className="mx-auto mb-2 text-[var(--color-text-muted)]" />
                <p className="text-xs font-medium text-[var(--color-text-primary)]">
                  {isExtracting ? 'Extracting…' : zipFileName ? zipFileName : 'Drop a zip here or click to browse'}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                  Max 50 MB. Local extraction — nothing is uploaded.
                </p>
              </div>
              {zipResult && (
                <details className="text-[10px] text-[var(--color-text-muted)]">
                  <summary className="cursor-pointer hover:text-[var(--color-text-secondary)]">
                    Show extracted .tf files ({zipResult.fileCount})
                  </summary>
                  <ul className="mt-1.5 pl-3 space-y-0.5 max-h-24 overflow-y-auto font-mono">
                    {zipResult.fileNames.map((name) => (
                      <li key={name}>· {name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

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

          {unresolvedRefs.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-1.5">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <p className="font-medium text-amber-300">
                    {unresolvedRefs.length} unresolved reference{unresolvedRefs.length === 1 ? '' : 's'}
                  </p>
                  <p className="text-[10px] text-amber-200/80 mt-0.5">
                    These policy refs (bare UUIDs from controller-emitted Terraform) couldn't be matched to any imported group and fell back to <code className="font-mono">sg-any</code>. The evaluator will flag those groups as "Unused SmartGroup" — that's why. Use Aviatrix Live (MCP) for a full-fidelity import.
                  </p>
                </div>
              </div>
              <details className="text-[10px] text-amber-200/80 pl-6">
                <summary className="cursor-pointer">Show unresolved refs</summary>
                <ul className="mt-1 space-y-0.5 list-disc pl-4 font-mono break-all">
                  {unresolvedRefs.slice(0, 20).map((r, i) => <li key={i}>{r}</li>)}
                  {unresolvedRefs.length > 20 && <li>… and {unresolvedRefs.length - 20} more</li>}
                </ul>
              </details>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
          {activeTab === 'terraform' && (
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
          )}
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
