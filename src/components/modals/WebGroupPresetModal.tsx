import { useState } from 'react';
import { X, Globe, Plus, Library, Search } from 'lucide-react';
import { WEBGROUP_PRESETS, getCategoryLabel, getCategoryColor } from '../../data/webGroupPresets';
import type { WebGroupPreset } from '../../data/webGroupPresets';

interface WebGroupPresetModalProps {
  existingNames: string[];
  onAdd: (preset: WebGroupPreset) => void;
  onClose: () => void;
}

export default function WebGroupPresetModal({ existingNames, onAdd, onClose }: WebGroupPresetModalProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = ['all', ...new Set(WEBGROUP_PRESETS.map((p) => p.category))];

  const filtered = WEBGROUP_PRESETS.filter((p) => {
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.fqdns.some((f) => f.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const isAdded = (name: string) => existingNames.some((n) => n.toLowerCase() === name.toLowerCase());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl shadow-2xl border"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Library size={16} className="text-[var(--color-accent-blue)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">WebGroup Library</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Search & Filter */}
        <div className="p-4 space-y-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search presets..."
              className="w-full pl-8 pr-3 py-1.5 rounded text-xs border outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: selectedCategory === cat ? 'var(--color-accent-blue)' : 'var(--color-surface)',
                  color: selectedCategory === cat ? '#fff' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                {cat === 'all' ? 'All' : getCategoryLabel(cat as WebGroupPreset['category'])}
              </button>
            ))}
          </div>
        </div>

        {/* Preset List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
              No presets match your search.
            </div>
          ) : (
            filtered.map((preset) => {
              const added = isAdded(preset.name);
              const color = getCategoryColor(preset.category);
              return (
                <div
                  key={preset.id}
                  className="rounded-lg border p-3 transition-colors"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border-subtle)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                          style={{ backgroundColor: color + '15', color }}
                        >
                          {getCategoryLabel(preset.category)}
                        </span>
                        {added && (
                          <span className="text-[9px] text-green-500 font-medium">Added</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Globe size={13} style={{ color }} />
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">{preset.name}</span>
                      </div>
                      <p className="text-[10px] text-[var(--color-text-muted)] mb-2">{preset.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {preset.fqdns.slice(0, 5).map((fqdn) => (
                          <span
                            key={fqdn}
                            className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}
                          >
                            {fqdn}
                          </span>
                        ))}
                        {preset.fqdns.length > 5 && (
                          <span className="text-[9px] text-[var(--color-text-muted)] px-1">+{preset.fqdns.length - 5} more</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => onAdd(preset)}
                      disabled={added}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors disabled:opacity-40"
                      style={{
                        backgroundColor: added ? 'var(--color-surface-elevated)' : 'var(--color-accent-blue)',
                        color: added ? 'var(--color-text-muted)' : '#fff',
                      }}
                    >
                      <Plus size={12} />
                      {added ? 'Added' : 'Add'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
