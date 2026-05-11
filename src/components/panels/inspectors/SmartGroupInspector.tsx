import { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import type { DcfPolicyModel, SmartGroupCriteria } from '../../../types/dcf';
import type { AIProfile } from '../../../lib/ai/types';
import { Input, Select, InspectorFooter } from './_shared';

interface SmartGroupInspectorProps {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null; // accepted for dispatch-uniformity; unused here
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

const CriteriaEditor = ({ criteria, onChange }: { criteria: SmartGroupCriteria[]; onChange: (c: SmartGroupCriteria[]) => void }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Match Criteria</label>
    <div className="space-y-1.5">
      {(criteria || []).map((c, i) => (
        <div key={i} className="flex flex-col gap-1 p-1.5 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1">
            <select
              value={c.type ?? 'vm'}
              onChange={(e) => {
                const next = [...criteria];
                const type = e.target.value as SmartGroupCriteria['type'];
                next[i] = type === 'vm' ? { type, key: '', operator: 'equals', value: '' } : { type, cidr: '' };
                onChange(next);
              }}
              className="w-28 px-1 py-1 rounded text-[10px] border outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            >
              <option value="vm">VM Tag</option>
              <option value="subnet">Subnet CIDR</option>
            </select>
            <button
              onClick={() => onChange(criteria.filter((_, idx) => idx !== i))}
              className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors ml-auto"
            >
              <Minus size={12} />
            </button>
          </div>
          {c.type === 'vm' ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={c.key ?? ''}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i]!, key: e.target.value };
                  onChange(next);
                }}
                placeholder="key"
                className="flex-1 min-w-0 px-1.5 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
              <select
                value={c.operator ?? 'equals'}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i]!, operator: e.target.value as SmartGroupCriteria['operator'] };
                  onChange(next);
                }}
                className="w-20 px-1 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              >
                <option value="equals">=</option>
                <option value="contains">contains</option>
                <option value="startsWith">starts</option>
              </select>
              <input
                type="text"
                value={c.value ?? ''}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i]!, value: e.target.value };
                  onChange(next);
                }}
                placeholder="value"
                className="flex-1 min-w-0 px-1.5 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
          ) : (
            <input
              type="text"
              value={c.cidr ?? ''}
              onChange={(e) => {
                const next = [...criteria];
                next[i] = { ...next[i]!, cidr: e.target.value };
                onChange(next);
              }}
              placeholder="10.0.0.0/24"
              className="w-full px-1.5 py-1 rounded text-[10px] border outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
          )}
        </div>
      ))}
      <button
        onClick={() => onChange([...(criteria || []), { type: 'vm', key: '', operator: 'equals', value: '' }])}
        className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
      >
        <Plus size={12} /> Add criterion
      </button>
    </div>
  </div>
);

export default function SmartGroupInspector({ topology, selectedItem, onBack, onSave, onDelete }: SmartGroupInspectorProps) {
  const group = useMemo(
    () => topology.smartGroups.find((x) => x.id === selectedItem.id),
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
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">SmartGroup</div>
          <Input label="Name" value={String(form.name ?? group.name)} onChange={(v) => updateField('name', v)} />
          <div className="mb-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={String(form.color ?? group.color)} onChange={(e) => updateField('color', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
              <span className="text-xs text-[var(--color-text-muted)] font-mono">{String(form.color ?? group.color)}</span>
            </div>
          </div>
          <Select label="Match Type" value={String(form.matchType ?? group.matchType)} options={[{ value: 'any', label: 'Match Any' }, { value: 'all', label: 'Match All' }]} onChange={(v) => updateField('matchType', v)} />
          <CriteriaEditor criteria={(form.criteria as SmartGroupCriteria[]) || group.criteria} onChange={(v) => updateField('criteria', v)} />
        </div>
      </div>
      <InspectorFooter dirty={dirty} onSave={() => onSave(form)} onDelete={onDelete} />
    </>
  );
}
