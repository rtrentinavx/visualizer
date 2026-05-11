import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DcfPolicyModel } from '../../../types/dcf';
import type { AIProfile } from '../../../lib/ai/types';
import { Input, StringListEditor, InspectorFooter } from './_shared';

interface GeoGroupInspectorProps {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null; // accepted for dispatch-uniformity; unused here
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

export default function GeoGroupInspector({ topology, selectedItem, onBack, onSave, onDelete }: GeoGroupInspectorProps) {
  const group = useMemo(
    () => topology.geoGroups.find((x) => x.id === selectedItem.id),
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

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
            <ArrowLeft size={12} /> Back
          </button>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">GeoGroup</div>
          <Input label="Name" value={String(form.name ?? group.name)} onChange={(v) => updateField('name', v)} />
          <StringListEditor label="Countries (ISO codes)" items={(form.countries as string[]) || group.countries} onChange={(v) => updateField('countries', v)} placeholder="US" />
        </div>
      </div>
      <InspectorFooter dirty={dirty} onSave={() => onSave(form)} onDelete={onDelete} />
    </>
  );
}
