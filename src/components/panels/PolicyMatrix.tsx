import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldX, Lock, Globe, Ban, LayoutGrid, Plus, Search } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel } from '../../types/dcf';

interface PolicyMatrixProps {
  topology: DcfPolicyModel;
  selectedCell: { srcId: string; dstId: string } | null;
  onSelectCell: (srcId: string, dstId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onSelectPolicy: (policyId: string, srcId?: string, dstId?: string) => void;
}

export default function PolicyMatrix({ topology, selectedCell, onSelectCell, onSelectGroup, onSelectPolicy }: PolicyMatrixProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const f = searchQuery.toLowerCase();

  const { groups, matrix } = useMemo(() => {
    const groups = topology.smartGroups.filter((g) => g.id !== 'sg-internet');
    const matrix: Record<string, Record<string, DcfPolicy[]>> = {};

    for (const src of groups) {
      matrix[src.id] = {};
      for (const dst of groups) {
        const policies = topology.policies.filter(
          (p) =>
            (p.srcGroupId === src.id || p.srcGroupId === 'sg-any') &&
            (p.dstGroupId === dst.id || p.dstGroupId === 'sg-any')
        );
        matrix[src.id][dst.id] = policies;
      }
    }

    return { groups, matrix };
  }, [topology]);

  const filteredGroups = useMemo(() => {
    if (!f) return groups;
    return groups.filter((g) =>
      g.name.toLowerCase().includes(f) ||
      g.criteria.some((c) => c.key?.toLowerCase().includes(f) || c.value?.toLowerCase().includes(f))
    );
  }, [groups, f]);

  const handleCellClick = (srcId: string, dstId: string, hasPolicies: boolean) => {
    onSelectCell(srcId, dstId);
    if (!hasPolicies) {
      onSelectPolicy('__new__', srcId, dstId);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Matrix</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Row = Source → Column = Destination. Click a cell with policies to view them. Click an empty cell to create one.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter groups..."
              className="pl-8 pr-3 py-1.5 rounded-md text-xs w-40 border outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
            {topology.policies.length} policies · {groups.length} groups
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
              <LayoutGrid size={24} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No SmartGroups yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">
              Create at least two SmartGroups to start building your policy matrix.
            </p>
            <button
              onClick={() => onSelectGroup('__new__')}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Plus size={14} />
              Create SmartGroup
            </button>
          </div>
        ) : (
        <div className="inline-block min-w-full p-4">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `120px repeat(${filteredGroups.length}, 90px)` }}
          >
            {/* Corner */}
            <div className="sticky top-0 left-0 z-20 p-2" style={{ backgroundColor: 'var(--color-surface-raised)' }} />

            {/* Header row */}
            {filteredGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="sticky top-0 z-10 p-1.5 text-center rounded hover:bg-[var(--color-surface-elevated)] transition-colors cursor-pointer"
                style={{ backgroundColor: 'var(--color-surface-raised)' }}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)] leading-tight truncate w-full">{g.name}</span>
                </div>
              </button>
            ))}

            {/* Rows */}
            {filteredGroups.map((src) => (
              <>
                {/* Row label */}
                <button
                  key={`row-${src.id}`}
                  onClick={() => onSelectGroup(src.id)}
                  className="sticky left-0 z-10 flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-surface-elevated)] transition-colors text-left cursor-pointer"
                  style={{ backgroundColor: 'var(--color-surface-raised)' }}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: src.color }} />
                  <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{src.name}</span>
                </button>

                {/* Cells */}
                {filteredGroups.map((dst) => {
                  const policies = matrix[src.id]?.[dst.id] ?? [];
                  const isSelf = src.id === dst.id;
                  const sorted = [...policies].sort((a, b) => a.priority - b.priority);
                  const effective = sorted[0];
                  const isSelected = selectedCell?.srcId === src.id && selectedCell?.dstId === dst.id;
                  const isEmpty = !isSelf && sorted.length === 0;

                  if (isSelf) {
                    return (
                      <div
                        key={`${src.id}-${dst.id}`}
                        className="p-1.5 rounded bg-[var(--color-surface-elevated)]/50"
                        title="Self — not applicable"
                      />
                    );
                  }

                  return (
                    <div
                      key={`${src.id}-${dst.id}`}
                      onClick={() => handleCellClick(src.id, dst.id, !isEmpty)}
                      className={`group relative flex flex-col gap-0.5 p-1.5 rounded border cursor-pointer transition-colors ${
                        isSelected
                          ? 'ring-2 ring-[var(--color-accent-blue)]'
                          : ''
                      } ${
                        effective
                          ? effective.action === 'allow'
                            ? 'bg-green-500/10 border-green-500/30'
                              : 'bg-red-500/10 border-red-500/30'
                          : isEmpty
                          ? 'bg-[var(--color-surface)] border-dashed border-[var(--color-border-subtle)] hover:border-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue)]/5'
                          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)]'
                      }`}
                      title={
                        isEmpty
                          ? 'Click to create a new policy'
                          : sorted.length > 0
                          ? sorted.map((p) => `#${p.priority} ${p.action.toUpperCase()} ${p.protocol}/${p.ports || 'any'}`).join(' \n')
                          : ''
                      }
                    >
                      {/* Empty cell hover: + icon */}
                      {isEmpty && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus size={14} className="text-[var(--color-accent-blue)]" />
                        </div>
                      )}

                      {isEmpty ? (
                        <span className="text-[10px] text-[var(--color-text-muted)] opacity-50 group-hover:opacity-0 transition-opacity">∅</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {sorted.map((p) => (
                            <div key={p.id} className="flex items-center gap-1">
                              {p.action === 'allow' ? (
                                <ShieldCheck size={10} className="text-green-400 shrink-0" />
                              ) : (
                                <ShieldX size={10} className="text-red-400 shrink-0" />
                              )}
                              <span className="text-[9px] font-mono text-[var(--color-text-muted)] leading-tight">
                                {p.priority}
                              </span>
                              <span className="text-[9px] font-mono text-[var(--color-text-muted)] leading-tight">
                                {p.ports || p.protocol}
                              </span>
                              {p.decrypt && <Lock size={8} className="text-[var(--color-accent-purple)] shrink-0" />}
                              {(p.threatGroup || p.geoGroup) && <Globe size={8} className="text-[var(--color-accent-amber)] shrink-0" />}
                              {(p.srcExcludeGroupIds?.length || p.dstExcludeGroupIds?.length) ? (
                                <span className="shrink-0" title="Excludes groups">
                                  <Ban size={8} className="text-[var(--color-accent-red)]" />
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-green-400" />
              <span>Allow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldX size={14} className="text-red-400" />
              <span>Deny</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock size={14} className="text-[var(--color-accent-purple)]" />
              <span>TLS Decrypt</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Globe size={14} className="text-[var(--color-accent-amber)]" />
              <span>Geo / Threat</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Ban size={14} className="text-[var(--color-accent-red)]" />
              <span>Excludes</span>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
