import { useMemo, useState } from 'react';
import { X, Sparkles, Shield, Network, FileCheck, Check, ChevronRight } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import { POLICY_TEMPLATES, type PolicyTemplate } from '../../data/policyTemplates';
import { previewPolicyTemplate, type ApplyTemplateResult } from '../../lib/applyPolicyTemplate';

interface PolicyTemplatesModalProps {
  topology: DcfPolicyModel;
  onApply: (newTopology: DcfPolicyModel) => void;
  onClose: () => void;
}

function CategoryIcon({ category }: { category: PolicyTemplate['category'] }) {
  if (category === 'security') return <Shield size={14} className="text-red-400" />;
  if (category === 'connectivity') return <Network size={14} className="text-[var(--color-accent-blue)]" />;
  return <FileCheck size={14} className="text-emerald-400" />;
}

function ChangeSummary({ result }: { result: ApplyTemplateResult }) {
  const addedCount =
    result.added.smartGroups.length +
    result.added.webGroups.length +
    result.added.threatGroups.length +
    result.added.geoGroups.length +
    result.added.policies.length;
  const reusedCount =
    result.reused.smartGroupNames.length +
    result.reused.webGroupNames.length +
    result.reused.threatGroupNames.length +
    result.reused.geoGroupNames.length;

  if (addedCount === 0 && reusedCount === 0) {
    return <span className="text-[10px] text-[var(--color-text-muted)]">Nothing to add — already applied.</span>;
  }
  return (
    <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
      {result.added.smartGroups.length > 0 && <div>+ {result.added.smartGroups.length} SmartGroup{result.added.smartGroups.length === 1 ? '' : 's'}: {result.added.smartGroups.map((g) => g.name).join(', ')}</div>}
      {result.added.webGroups.length > 0 && <div>+ {result.added.webGroups.length} WebGroup{result.added.webGroups.length === 1 ? '' : 's'}: {result.added.webGroups.map((g) => g.name).join(', ')}</div>}
      {result.added.threatGroups.length > 0 && <div>+ {result.added.threatGroups.length} ThreatGroup{result.added.threatGroups.length === 1 ? '' : 's'}: {result.added.threatGroups.map((g) => g.name).join(', ')}</div>}
      {result.added.geoGroups.length > 0 && <div>+ {result.added.geoGroups.length} GeoGroup{result.added.geoGroups.length === 1 ? '' : 's'}: {result.added.geoGroups.map((g) => g.name).join(', ')}</div>}
      {result.added.policies.length > 0 && <div>+ {result.added.policies.length} polic{result.added.policies.length === 1 ? 'y' : 'ies'}: {result.added.policies.map((p) => p.name).join(', ')}</div>}
      {reusedCount > 0 && <div className="text-emerald-500">↻ reuses existing: {[...result.reused.smartGroupNames, ...result.reused.webGroupNames, ...result.reused.threatGroupNames, ...result.reused.geoGroupNames].join(', ')}</div>}
      {result.skipped.duplicatePolicies.length > 0 && <div className="text-amber-500">⊘ skips {result.skipped.duplicatePolicies.length} duplicate polic{result.skipped.duplicatePolicies.length === 1 ? 'y' : 'ies'}: {result.skipped.duplicatePolicies.join(', ')}</div>}
    </div>
  );
}

export default function PolicyTemplatesModal({ topology, onApply, onClose }: PolicyTemplatesModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(POLICY_TEMPLATES[0]?.id ?? null);
  const [applied, setApplied] = useState(false);

  const selected = POLICY_TEMPLATES.find((t) => t.id === selectedId) ?? null;
  const preview = useMemo(() => (selected ? previewPolicyTemplate(topology, selected) : null), [topology, selected]);
  const nothingToDo = preview ? preview.added.smartGroups.length + preview.added.webGroups.length + preview.added.threatGroups.length + preview.added.geoGroups.length + preview.added.policies.length === 0 : true;

  const handleApply = () => {
    if (!preview || nothingToDo) return;
    onApply(preview.topology);
    setApplied(true);
    setTimeout(onClose, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-[var(--color-accent-purple)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Templates</h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                Pre-built patterns. Existing groups (by name) are reused; duplicate policies are skipped.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-[260px_1fr]">
          <div className="overflow-y-auto border-r border-[var(--color-border-subtle)] p-2 space-y-1">
            {POLICY_TEMPLATES.map((tpl) => {
              const isSelected = tpl.id === selectedId;
              return (
                <button
                  key={tpl.id}
                  onClick={() => setSelectedId(tpl.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5'
                      : 'border-transparent hover:bg-[var(--color-surface)] hover:border-[var(--color-border-subtle)]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CategoryIcon category={tpl.category} />
                    <span className="text-xs font-medium text-[var(--color-text-primary)] flex-1 truncate">{tpl.name}</span>
                    {isSelected && <ChevronRight size={12} className="text-[var(--color-accent-blue)]" />}
                  </div>
                  <p className="text-[10px] text-[var(--color-text-muted)] line-clamp-2">
                    {tpl.description}
                  </p>
                  <div className="text-[9px] text-[var(--color-text-muted)] mt-1.5 flex gap-2">
                    {tpl.smartGroups.length > 0 && <span>{tpl.smartGroups.length} SG</span>}
                    {tpl.webGroups && tpl.webGroups.length > 0 && <span>{tpl.webGroups.length} WG</span>}
                    {tpl.threatGroups && tpl.threatGroups.length > 0 && <span>{tpl.threatGroups.length} TG</span>}
                    {tpl.geoGroups && tpl.geoGroups.length > 0 && <span>{tpl.geoGroups.length} GG</span>}
                    <span>{tpl.policies.length} polic{tpl.policies.length === 1 ? 'y' : 'ies'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto p-4 space-y-4">
            {!selected ? (
              <div className="text-xs text-[var(--color-text-muted)]">Select a template on the left.</div>
            ) : (
              <>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CategoryIcon category={selected.category} />
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{selected.name}</h3>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{selected.description}</p>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">What this template defines</h4>
                  <div className="space-y-2 text-xs">
                    {selected.smartGroups.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">SmartGroups</div>
                        <ul className="space-y-1">
                          {selected.smartGroups.map((g) => (
                            <li key={g.refId} className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                              <span className="font-medium text-[var(--color-text-primary)]">{g.name}</span>
                              <span className="text-[10px] text-[var(--color-text-muted)]">
                                {g.criteria.map((c) => c.type === 'vm' ? `${c.key} ${c.operator ?? '='} ${c.value}` : `subnet ${c.cidr}`).join(g.matchType === 'all' ? ' AND ' : ' OR ')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selected.threatGroups && selected.threatGroups.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">ThreatGroups</div>
                        <ul className="space-y-0.5">
                          {selected.threatGroups.map((g) => (
                            <li key={g.refId}><span className="font-medium text-[var(--color-text-primary)]">{g.name}</span> <span className="text-[10px] text-[var(--color-text-muted)]">({g.category})</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selected.geoGroups && selected.geoGroups.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">GeoGroups</div>
                        <ul className="space-y-0.5">
                          {selected.geoGroups.map((g) => (
                            <li key={g.refId}><span className="font-medium text-[var(--color-text-primary)]">{g.name}</span> <span className="text-[10px] text-[var(--color-text-muted)]">{g.countries.join(', ')}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Policies</div>
                      <ul className="space-y-0.5">
                        {selected.policies.map((p) => (
                          <li key={`${p.name}|${p.srcGroupRef}|${p.dstGroupRef}`} className="font-mono text-[10px] text-[var(--color-text-secondary)]">
                            #{p.priority} {p.action.toUpperCase()} {p.srcGroupRef} → {p.dstGroupRef} · {p.protocol}/{p.ports ?? 'any'}{p.threatGroupRef ? ` · threat=${p.threatGroupRef}` : ''}{p.geoGroupRef ? ` · geo=${p.geoGroupRef}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {preview && (
                  <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Preview against your current topology</h4>
                    <ChangeSummary result={preview} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium border"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!selected || nothingToDo || applied}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Check size={13} />
            {applied ? 'Applied' : nothingToDo ? 'Already applied' : 'Apply template'}
          </button>
        </div>
      </div>
    </div>
  );
}
