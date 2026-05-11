import { X, FileCode } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import { generateTerraform, downloadTerraform } from '../../lib/terraformExport';

interface TerraformExportModalProps {
  topology: DcfPolicyModel;
  onClose: () => void;
}

export default function TerraformExportModal({ topology, onClose }: TerraformExportModalProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(generateTerraform(topology)).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Terraform Export</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
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
            onClick={handleCopy}
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
  );
}
