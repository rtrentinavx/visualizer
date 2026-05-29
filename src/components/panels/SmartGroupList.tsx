import { useMemo, useState } from 'react';
import {
  Search, X, ChevronUp, ChevronDown, ChevronsUpDown,
  Layers, Plus, Tag, Network, Trash2,
} from 'lucide-react';
import type { DcfPolicyModel, SmartGroup, SmartGroupCriteria } from '../../types/dcf';
import ConfirmModal from '../modals/ConfirmModal';

const SPECIAL_IDS = new Set(['sg-any', 'sg-internet']);

type SortKey = 'name' | 'type' | 'criteria' | 'src' | 'dst' | 'total';
type SortDir = 'asc' | 'desc';

type CriteriaType = 'tag' | 'cidr' | 'mixed' | 'empty' | 'special';

interface GroupRow {
  group: SmartGroup;
  criteriaType: CriteriaType;
  srcCount: number;
  dstCount: number;
  totalCount: number;
  isSpecial: boolean;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={10} className="opacity-30" />;
  return dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
}

function criteriaTypeOf(g: SmartGroup): CriteriaType {
  if (SPECIAL_IDS.has(g.id)) return 'special';
  if (!g.criteria || g.criteria.length === 0) return 'empty';
  const hasTag = g.criteria.some((c) => c.type === 'vm');
  const hasCidr = g.criteria.some((c) => c.type === 'subnet');
  if (hasTag && hasCidr) return 'mixed';
  if (hasTag) return 'tag';
  return 'cidr';
}

function criteriaLabel(c: SmartGroupCriteria): string {
  if (c.type === 'subnet') return c.cidr ?? '?';
  if (c.key && c.value) {
    const op = c.operator === 'contains' ? '~' : c.operator === 'startsWith' ? '^' : '=';
    return `${c.key}${op}${c.value}`;
  }
  return c.key ?? '?';
}

function CriteriaTypeBadge({ type }: { type: CriteriaType }) {
  if (type === 'special') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
        Built-in
      </span>
    );
  }
  if (type === 'tag') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
        <Tag size={9} />
        Tag
      </span>
    );
  }
  if (type === 'cidr') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <Network size={9} />
        CIDR
      </span>
    );
  }
  if (type === 'mixed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20">
        Mixed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
      Empty
    </span>
  );
}

interface SmartGroupListProps {
  topology: DcfPolicyModel;
  onSelectGroup: (groupId: string) => void;
  onNewGroup?: () => void;
  onBulkDeleteGroups?: (ids: string[]) => void;
}

export default function SmartGroupList({ topology, onSelectGroup, onNewGroup, onBulkDeleteGroups }: SmartGroupListProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  // Build policy usage counts per group
  const usageMap = useMemo(() => {
    const src = new Map<string, number>();
    const dst = new Map<string, number>();
    for (const p of topology.policies) {
      src.set(p.srcGroupId, (src.get(p.srcGroupId) ?? 0) + 1);
      dst.set(p.dstGroupId, (dst.get(p.dstGroupId) ?? 0) + 1);
      for (const id of p.srcExcludeGroupIds ?? []) src.set(id, (src.get(id) ?? 0) + 1);
      for (const id of p.dstExcludeGroupIds ?? []) dst.set(id, (dst.get(id) ?? 0) + 1);
    }
    return { src, dst };
  }, [topology.policies]);

  const rows = useMemo<GroupRow[]>(() =>
    topology.smartGroups.map((g) => {
      const srcCount = usageMap.src.get(g.id) ?? 0;
      const dstCount = usageMap.dst.get(g.id) ?? 0;
      return {
        group: g,
        criteriaType: criteriaTypeOf(g),
        srcCount,
        dstCount,
        totalCount: srcCount + dstCount,
        isSpecial: SPECIAL_IDS.has(g.id),
      };
    }),
  [topology.smartGroups, usageMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.group.name.toLowerCase().includes(q) ||
      r.criteriaType.includes(q) ||
      r.group.criteria.some((c) => criteriaLabel(c).toLowerCase().includes(q))
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':     cmp = a.group.name.localeCompare(b.group.name); break;
        case 'type':     cmp = a.criteriaType.localeCompare(b.criteriaType); break;
        case 'criteria': cmp = a.group.criteria.length - b.group.criteria.length; break;
        case 'src':      cmp = a.srcCount - b.srcCount; break;
        case 'dst':      cmp = a.dstCount - b.dstCount; break;
        case 'total':    cmp = a.totalCount - b.totalCount; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const thClass = (key: SortKey) =>
    `px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors hover:text-[var(--color-text-primary)] ${
      sortKey === key ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
    }`;

  const total = topology.smartGroups.length;
  const nonSpecial = total - topology.smartGroups.filter((g) => SPECIAL_IDS.has(g.id)).length;

  // Only non-special rows are selectable
  const selectableIds = sorted.filter((r) => !r.isSpecial).map((r) => r.group.id);
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelectableSelected = selectableIds.some((id) => selected.has(id));

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...selectableIds]));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Cascade: count policies that reference any selected group
  const cascadePolicyCount = useMemo(() => {
    if (selected.size === 0) return 0;
    return topology.policies.filter(
      (p) => selected.has(p.srcGroupId) || selected.has(p.dstGroupId)
    ).length;
  }, [selected, topology.policies]);

  const handleBulkDelete = () => {
    if (onBulkDeleteGroups) {
      onBulkDeleteGroups([...selected]);
    }
    setSelected(new Set());
    setShowConfirm(false);
  };

  const selectionCount = selected.size;

  const confirmMessage = cascadePolicyCount > 0
    ? `Delete ${selectionCount} ${selectionCount === 1 ? 'group' : 'groups'} — this will also remove ${cascadePolicyCount} ${cascadePolicyCount === 1 ? 'policy' : 'policies'} that reference them. This action cannot be undone.`
    : `Delete ${selectionCount} ${selectionCount === 1 ? 'group' : 'groups'}. This action cannot be undone.`;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
            SmartGroup List
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {filtered.length === total
              ? `${nonSpecial} groups + 2 built-in, sorted by ${sortKey}`
              : `${filtered.length} of ${total} groups`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-md border px-2 py-1"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: search ? 'var(--color-accent-blue)' : 'var(--color-input-border)' }}
          >
            <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter groups…"
              className="w-40 text-xs bg-transparent outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="p-0.5 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                <X size={10} />
              </button>
            )}
          </div>
          {onNewGroup && (
            <button
              onClick={onNewGroup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Plus size={12} />
              New Group
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
              <Layers size={24} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No SmartGroups yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">
              Import a topology or create groups to start building policies.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No matches for "{search}"</p>
            <button onClick={() => setSearch('')} className="mt-2 text-xs text-[var(--color-accent-blue)] hover:underline">
              Clear filter
            </button>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface-raised)' }}>
              <tr className="border-b border-[var(--color-border-subtle)]">
                {onBulkDeleteGroups && (
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelectableSelected && !allSelectableSelected; }}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-[var(--color-aviatrix)]"
                      aria-label="Select all non-built-in groups"
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                )}
                <th onClick={() => handleSort('name')} className={thClass('name')}>
                  <span className="flex items-center gap-1">Name<SortIcon active={sortKey === 'name'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('type')} className={thClass('type')}>
                  <span className="flex items-center gap-1">Type<SortIcon active={sortKey === 'type'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('criteria')} className={thClass('criteria')}>
                  <span className="flex items-center gap-1">Criteria<SortIcon active={sortKey === 'criteria'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('src')} className={thClass('src')}>
                  <span className="flex items-center gap-1">Src policies<SortIcon active={sortKey === 'src'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('dst')} className={thClass('dst')}>
                  <span className="flex items-center gap-1">Dst policies<SortIcon active={sortKey === 'dst'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('total')} className={thClass('total')}>
                  <span className="flex items-center gap-1">Total<SortIcon active={sortKey === 'total'} dir={sortDir} /></span>
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] whitespace-nowrap">
                  Flags
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const { group: g, criteriaType, srcCount, dstCount, totalCount, isSpecial } = row;
                const isUnused = !isSpecial && totalCount === 0;
                const isCidrOnly = criteriaType === 'cidr';
                const isSelected = selected.has(g.id);

                return (
                  <tr
                    key={g.id}
                    onClick={() => onSelectGroup(g.id)}
                    className="border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors hover:bg-[var(--color-surface-elevated)]"
                    style={{
                      backgroundColor: isSelected
                        ? 'var(--color-accent-blue)18'
                        : i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                    }}
                  >
                    {onBulkDeleteGroups && (
                      <td className="px-3 py-2 w-8" onClick={(e) => { e.stopPropagation(); if (!isSpecial) toggleRow(g.id); }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => { if (!isSpecial) toggleRow(g.id); }}
                          disabled={isSpecial}
                          className="cursor-pointer accent-[var(--color-aviatrix)] disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label={`Select group ${g.name}`}
                        />
                      </td>
                    )}
                    {/* Name + color chip */}
                    <td className="px-3 py-2 font-medium text-[var(--color-text-primary)] max-w-[220px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/20"
                          style={{ backgroundColor: g.color }}
                        />
                        <span className="truncate">{g.name}</span>
                      </div>
                    </td>

                    {/* Type badge */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <CriteriaTypeBadge type={criteriaType} />
                    </td>

                    {/* Criteria preview */}
                    <td className="px-3 py-2 text-[var(--color-text-muted)] max-w-[280px]">
                      {isSpecial ? (
                        <span className="italic">wildcard</span>
                      ) : g.criteria.length === 0 ? (
                        <span className="italic opacity-50">none</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {g.criteria.slice(0, 3).map((c, ci) => (
                            <span
                              key={ci}
                              className="inline-block font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] truncate max-w-[140px]"
                              title={criteriaLabel(c)}
                            >
                              {criteriaLabel(c)}
                            </span>
                          ))}
                          {g.criteria.length > 3 && (
                            <span className="text-[10px] text-[var(--color-text-muted)] self-center">
                              +{g.criteria.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Src count */}
                    <td className="px-3 py-2 text-center font-mono">
                      <span className={srcCount > 0 ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)] opacity-40'}>
                        {srcCount}
                      </span>
                    </td>

                    {/* Dst count */}
                    <td className="px-3 py-2 text-center font-mono">
                      <span className={dstCount > 0 ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)] opacity-40'}>
                        {dstCount}
                      </span>
                    </td>

                    {/* Total */}
                    <td className="px-3 py-2 text-center font-mono font-semibold">
                      <span className={totalCount > 0 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] opacity-40'}>
                        {isSpecial ? '—' : totalCount}
                      </span>
                    </td>

                    {/* Flags */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isUnused && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            unused
                          </span>
                        )}
                        {isCidrOnly && !isSpecial && (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            title="Static CIDRs only — new VMs won't auto-enroll. Add tag criteria for dynamic membership."
                          >
                            cidr-only
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bulk action bar */}
      {selectionCount > 0 && onBulkDeleteGroups && (
        <div
          className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        >
          <span className="text-xs text-[var(--color-text-secondary)] font-medium">
            {selectionCount} {selectionCount === 1 ? 'group' : 'groups'} selected
            {cascadePolicyCount > 0 && (
              <span className="ml-1.5 text-amber-400">
                · will remove {cascadePolicyCount} {cascadePolicyCount === 1 ? 'policy' : 'policies'}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1 rounded text-xs border transition-colors"
              style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
            >
              Clear
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium text-white transition-colors bg-red-500 hover:bg-red-600"
            >
              <Trash2 size={11} />
              Delete {selectionCount}
            </button>
          </div>
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          title={cascadePolicyCount > 0 ? 'Cascade delete — groups + policies' : `Delete ${selectionCount} ${selectionCount === 1 ? 'group' : 'groups'}?`}
          message={confirmMessage}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
