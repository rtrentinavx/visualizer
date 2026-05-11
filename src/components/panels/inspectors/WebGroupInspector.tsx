import { useMemo, useState } from 'react';
import { ArrowLeft, Wand2 } from 'lucide-react';
import type { DcfPolicyModel } from '../../../types/dcf';
import type { AIProfile } from '../../../lib/ai/types';
import { StringListEditor, InspectorFooter } from './_shared';

interface WebGroupInspectorProps {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null; // accepted for dispatch-uniformity; unused here
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

export default function WebGroupInspector({ topology, selectedItem, onBack, onSave, onDelete }: WebGroupInspectorProps) {
  const group = useMemo(
    () => topology.webGroups.find((x) => x.id === selectedItem.id),
    [topology, selectedItem.id],
  );

  const initialForm = useMemo<Record<string, unknown>>(() => (group ? { ...group } : {}), [group]);

  const [form, setForm] = useState<Record<string, unknown>>(initialForm);
  const [dirty, setDirty] = useState(true);

  const updateField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  if (!group) return null;

  const handleAutoName = () => {
    const fqdns = ((form.fqdns as string[]) || group.fqdns || []);
    if (fqdns.length === 0) {
      updateField('name', 'New Web Group');
      return;
    }
    // Extract base domains and capitalize
    const bases = fqdns.map((f) => {
      const clean = f.replace(/^\*\./, '');
      const parts = clean.split('.');
      return parts.length >= 2 ? (parts[parts.length - 2] ?? clean) : clean;
    });
    const unique = [...new Set(bases)];
    const name = unique.map((b) => b.charAt(0).toUpperCase() + b.slice(1)).join(' & ');
    updateField('name', name + ' Apps');
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
            <ArrowLeft size={12} /> Back
          </button>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">WebGroup</div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Name</label>
              <button
                onClick={handleAutoName}
                className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
                title="Generate name from FQDNs"
              >
                <Wand2 size={10} /> Auto
              </button>
            </div>
            <input
              type="text"
              value={String(form.name ?? group.name)}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
            />
          </div>
          <StringListEditor label="FQDNs" items={(form.fqdns as string[]) || group.fqdns} onChange={(v) => updateField('fqdns', v)} placeholder="*.example.com" />
        </div>
      </div>
      <InspectorFooter dirty={dirty} onSave={() => onSave(form)} onDelete={onDelete} />
    </>
  );
}
