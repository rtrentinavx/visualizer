import { useRef, useState } from 'react';
import { X, Upload, FileCode, FileJson, FileArchive, AlertTriangle, CheckCircle } from 'lucide-react';
import { unzipSync, strFromU8 } from 'fflate';
import { importTopologyJSON, importTerraformHCL } from '../../lib/importExport';
import type { DcfPolicyModel } from '../../types/dcf';

interface ImportPanelProps {
  onImport: (topology: DcfPolicyModel) => void;
  onClose: () => void;
}

type ImportTab = 'json' | 'terraform' | 'zip';

interface ZipResult {
  fileCount: number;
  fileNames: string[];
  topology: DcfPolicyModel;
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
  const topology = importTerraformHCL(hcl);
  return { fileCount: tfNames.length, fileNames: tfNames, topology };
}

export default function ImportPanel({ onImport, onClose }: ImportPanelProps) {
  const [activeTab, setActiveTab] = useState<ImportTab>('json');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<DcfPolicyModel | null>(null);
  const [zipResult, setZipResult] = useState<ZipResult | null>(null);
  const [zipFileName, setZipFileName] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setError(null);
    setSuccess(null);
    setPreview(null);
    setZipResult(null);
    setZipFileName(null);
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
      if (activeTab === 'json') {
        const topology = importTopologyJSON(input.trim());
        setPreview(topology);
        setSuccess(`Valid JSON topology: ${topology.smartGroups.length} groups, ${topology.policies.length} policies.`);
      } else if (activeTab === 'terraform') {
        const topology = importTerraformHCL(input.trim());
        setPreview(topology);
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
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">JSON paste · Terraform paste · Terraform zip upload</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => switchTab('json')}
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
        </div>

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
          {activeTab === 'zip' && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Drop a zipped Terraform project. We extract every <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.tf</code> file
              (skipping <code className="px-1 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[10px]">.terraform/</code> vendored content)
              and pull only Aviatrix DCF resources. Non-DCF resources are silently ignored.
            </p>
          )}

          {activeTab !== 'zip' && (
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
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
          {activeTab !== 'zip' && (
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
