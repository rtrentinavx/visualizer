import { useState } from 'react';
import { X, Globe, Plus, Lightbulb, Check } from 'lucide-react';
import { WEBGROUP_PRESETS, getCategoryLabel, getCategoryColor } from '../../data/webGroupPresets';
import type { WebGroupPreset } from '../../data/webGroupPresets';

interface RecommendationsModalProps {
  existingNames: string[];
  onAccept: (presets: WebGroupPreset[]) => void;
  onDismiss: () => void;
}

export default function RecommendationsModal({ existingNames, onAccept, onDismiss }: RecommendationsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const togglePreset = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAdded = (name: string) => existingNames.some((n) => n.toLowerCase() === name.toLowerCase());

  const handleAccept = () => {
    const presets = WEBGROUP_PRESETS.filter((p) => selected.has(p.id) && !isAdded(p.name));
    onAccept(presets);
  };

  const allSelected = selected.size === WEBGROUP_PRESETS.length;
  const noneSelected = selected.size === 0;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(WEBGROUP_PRESETS.map((p) => p.id)));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onDismiss}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl shadow-2xl border"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recommended WebGroups</h3>
          </div>
          <button onClick={onDismiss} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Description */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs text-[var(--color-text-secondary)]">
            We found curated WebGroup presets you may want to add to your topology. Select the ones you want and click Accept.
          </p>
        </div>

        {/* Select All */}
        <div className="px-4 py-2">
          <button
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-accent-blue)] hover:underline"
          >
            {allSelected ? (
              <>
                <X size={12} /> Deselect All
              </>
            ) : (
              <>
                <Check size={12} /> Select All
              </>
            )}
          </button>
        </div>

        {/* Preset List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {WEBGROUP_PRESETS.map((preset) => {
            const added = isAdded(preset.name);
            const checked = selected.has(preset.id);
            const color = getCategoryColor(preset.category);
            return (
              <div
                key={preset.id}
                onClick={() => !added && togglePreset(preset.id)}
                className={`rounded-lg border p-3 transition-colors cursor-pointer ${added ? 'opacity-60' : ''}`}
                style={{
                  backgroundColor: checked ? 'var(--color-surface)' : 'var(--color-surface)',
                  borderColor: checked ? color + '60' : 'var(--color-border-subtle)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <div
                      className="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                      style={{
                        borderColor: checked ? color : 'var(--color-border-subtle)',
                        backgroundColor: checked ? color : 'transparent',
                      }}
                    >
                      {checked && <Check size={10} className="text-white" />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                        style={{ backgroundColor: color + '15', color }}
                      >
                        {getCategoryLabel(preset.category)}
                      </span>
                      {added && (
                        <span className="text-[9px] text-green-500 font-medium">Already added</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Globe size={13} style={{ color }} />
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">{preset.name}</span>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5">{preset.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {preset.fqdns.slice(0, 4).map((fqdn) => (
                        <span
                          key={fqdn}
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                          style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}
                        >
                          {fqdn}
                        </span>
                      ))}
                      {preset.fqdns.length > 4 && (
                        <span className="text-[9px] text-[var(--color-text-muted)] px-1">+{preset.fqdns.length - 4} more</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between gap-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            Not Now
          </button>
          <button
            onClick={handleAccept}
            disabled={noneSelected}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Plus size={12} />
            Accept {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
