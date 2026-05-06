import { useMemo } from 'react';
import { ShieldCheck, ShieldX, Lock, Globe, ArrowRight, ArrowLeft, ArrowLeftRight, Route, Ban } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel, PolicyDirection } from '../../types/dcf';

interface PolicyMatrixProps {
  topology: DcfPolicyModel;
  searchQuery: string;
  selectedCell: { srcId: string; dstId: string } | null;
  onSelectCell: (srcId: string, dstId: string) => void;
  onSelectGroup: (groupId: string) => void;
}

function directionIcon(dir: PolicyDirection) {
  if (dir === 'inbound') return <ArrowLeft size={10} className="opacity-70" />;
  if (dir === 'outbound') return <ArrowRight size={10} className="opacity-70" />;
  return <ArrowLeftRight size={10} className="opacity-70" />;
}

function directionLabel(dir: PolicyDirection) {
  if (dir === 'inbound') return 'in';
  if (dir === 'outbound') return 'out';
  return 'any';
}

export default function PolicyMatrix({ topology, searchQuery, selectedCell, onSelectCell, onSelectGroup }: PolicyMatrixProps) {
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

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Matrix</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Click any cell to view or edit policies
          </p>
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          {topology.policies.length} policies · {groups.length} groups
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="inline-block min-w-full">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `140px repeat(${filteredGroups.length}, minmax(120px, 1fr))` }}
          >
            {/* Header row */}
            <div className="p-2" />
            {filteredGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="p-2 text-center rounded hover:bg-[var(--color-surface-elevated)] transition-colors cursor-pointer"
              >
                <div className="flex flex-col items-center gap-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)] leading-tight">{g.name}</span>
                </div>
              </button>
            ))}

            {/* Rows */}
            {filteredGroups.map((src) => (
              <>
                <button
                  key={`row-${src.id}`}
                  onClick={() => onSelectGroup(src.id)}
                  className="flex items-center gap-2 px-2 py-2 rounded hover:bg-[var(--color-surface-elevated)] transition-colors text-left cursor-pointer"
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: src.color }} />
                  <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{src.name}</span>
                </button>
                {filteredGroups.map((dst) => {
                  const policies = matrix[src.id]?.[dst.id] ?? [];
                  const isSelf = src.id === dst.id;
                  const sorted = [...policies].sort((a, b) => a.priority - b.priority);
                  const effective = sorted[0];
                  const isSelected = selectedCell?.srcId === src.id && selectedCell?.dstId === dst.id;

                  return (
                    <div
                      key={`${src.id}-${dst.id}`}
                      onClick={() => onSelectCell(src.id, dst.id)}
                      className={`flex flex-col gap-1 p-2 rounded border cursor-pointer transition-colors ${
                        isSelected
                          ? 'ring-2 ring-[var(--color-accent-blue)]'
                          : ''
                      } ${
                        effective
                          ? effective.action === 'allow'
                            ? 'bg-green-500/10 border-green-500/30'
                            : effective.action === 'learned'
                            ? 'bg-[var(--color-accent-purple)]/10 border-[var(--color-accent-purple)]/30'
                            : 'bg-red-500/10 border-red-500/30'
                          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] hover:border-[var(--color-text-muted)]'
                      }`}
                      title={
                        sorted.length > 0
                          ? sorted.map((p) => `#${p.priority} ${p.action.toUpperCase()} ${directionLabel(p.direction)} ${p.protocol}/${p.ports || 'any'}`).join(' \n')
                          : 'No explicit policy — click to create one'
                      }
                    >
                      {isSelf ? (
                        <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                      ) : sorted.length === 0 ? (
                        <span className="text-[10px] text-[var(--color-text-muted)] opacity-50">∅</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {sorted.map((p) => (
                            <div key={p.id} className="flex items-center gap-1">
                              {p.action === 'allow' ? (
                                <ShieldCheck size={12} className="text-green-400 shrink-0" />
                              ) : p.action === 'learned' ? (
                                <Route size={12} className="text-[var(--color-accent-purple)] shrink-0" />
                              ) : (
                                <ShieldX size={12} className="text-red-400 shrink-0" />
                              )}
                              <span className="text-[9px] font-mono text-[var(--color-text-muted)] leading-tight">
                                {p.priority}
                              </span>
                              {directionIcon(p.direction)}
                              <span className="text-[9px] font-mono text-[var(--color-text-muted)] leading-tight">
                                {p.ports || p.protocol}
                              </span>
                              {p.decrypt && <Lock size={9} className="text-[var(--color-accent-purple)] shrink-0" />}
                              {(p.threatGroup || p.geoGroup) && <Globe size={9} className="text-[var(--color-accent-amber)] shrink-0" />}
                              {(p.srcExcludeGroupIds?.length || p.dstExcludeGroupIds?.length) ? (
                                <span className="shrink-0" title="Excludes groups">
                                  <Ban size={9} className="text-[var(--color-accent-red)]" />
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
            <Route size={14} className="text-[var(--color-accent-purple)]" />
            <span>Learned</span>
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
          <div className="flex items-center gap-1.5">
            <ArrowLeftRight size={14} />
            <span>Direction</span>
          </div>
        </div>
      </div>
    </div>
  );
}
