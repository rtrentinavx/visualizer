import { useState, useMemo } from 'react';
import { X, FileCode, Package, Boxes } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import { generateTerraform, generateTerraformModule } from '../../lib/terraformExport';

interface TerraformExportModalProps {
  topology: DcfPolicyModel;
  onClose: () => void;
}

type ExportStyle = 'module' | 'raw';

export default function TerraformExportModal({ topology, onClose }: TerraformExportModalProps) {
  const [style, setStyle] = useState<ExportStyle>('module');

  // Generate on every render of this state — the topology is small enough that
  // re-rendering the HCL on each toggle is sub-ms and a useMemo cache buys
  // nothing meaningful.
  const content = useMemo(
    () => (style === 'module' ? generateTerraformModule(topology) : generateTerraform(topology)),
    [style, topology],
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
  };

  const handleDownload = () => {
    const filename = style === 'module' ? 'aviatrix_dcf_module.tf' : 'aviatrix_dcf.tf';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

        {/* Style toggle */}
        <div className="px-4 pt-3 pb-2 border-b border-[var(--color-border-subtle)] flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mr-1">Style:</span>
          <StyleButton
            label="Module"
            hint="terraform-aviatrix-modules/dcf-framework — recommended"
            icon={Package}
            active={style === 'module'}
            onClick={() => setStyle('module')}
          />
          <StyleButton
            label="Raw resources"
            hint="legacy — emits aviatrix_smart_group / aviatrix_distributed_firewalling_policy_list directly"
            icon={Boxes}
            active={style === 'raw'}
            onClick={() => setStyle('raw')}
          />
        </div>

        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all" style={{ color: 'var(--color-text-secondary)' }}>
            {content}
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
            onClick={handleDownload}
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

function StyleButton({
  label,
  hint,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors"
      style={{
        backgroundColor: active ? 'var(--color-aviatrix)' : 'var(--color-surface)',
        borderColor: active ? 'var(--color-aviatrix)' : 'var(--color-border-subtle)',
        color: active ? '#fff' : 'var(--color-text-secondary)',
      }}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}
