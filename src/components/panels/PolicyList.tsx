import { useCallback, useMemo, useState } from 'react';
import {
  Plus, Search, X, ChevronUp, ChevronDown, ChevronsUpDown,
  ShieldCheck, ShieldX, Lock, Globe, Ban, List, Trash2,
} from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import ConfirmModal from '../modals/ConfirmModal';

type SortKey = 'priority' | 'name' | 'src' | 'dst' | 'action' | 'protocol';
type SortDir = 'asc' | 'desc';

interface PolicyListProps {
  topology: DcfPolicyModel;
  onSelectPolicy: (policyId: string, srcId?: string, dstId?: string) => void;
  onBulkDeletePolicies?: (ids: string[]) => void;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={10} className="opacity-30" />;
  return dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
}

function ActionBadge({ action }: { action: string }) {
  if (action === 'allow') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
        <ShieldCheck size={10} />
        Allow
      </span>
    );
  }
  if (action === 'deny') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
        <ShieldX size={10} />
        Deny
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]">
      {action}
    </span>
  );
}

export default function PolicyList({ topology, onSelectPolicy, onBulkDeletePolicies }: PolicyListProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);

  const groupMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of topology.smartGroups) m.set(g.id, g.name);
    return m;
  }, [topology.smartGroups]);

  const gName = useCallback((id: string) => groupMap.get(id) ?? id, [groupMap]);
  const gNames = useCallback((ids: string[]) => ids.map(gName).join(', '), [gName]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return topology.policies;
    return topology.policies.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.srcGroupId.some((id) => gName(id).toLowerCase().includes(q)) ||
      p.dstGroupId.some((id) => gName(id).toLowerCase().includes(q)) ||
      p.action.toLowerCase().includes(q) ||
      p.protocol.toLowerCase().includes(q) ||
      (p.ports ?? '').toLowerCase().includes(q)
    );
  }, [topology.policies, search, gName]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'priority':  cmp = a.priority - b.priority; break;
        case 'name':      cmp = a.name.localeCompare(b.name); break;
        case 'src':       cmp = gNames(a.srcGroupId).localeCompare(gNames(b.srcGroupId)); break;
        case 'dst':       cmp = gNames(a.dstGroupId).localeCompare(gNames(b.dstGroupId)); break;
        case 'action':    cmp = a.action.localeCompare(b.action); break;
        case 'protocol':  cmp = a.protocol.localeCompare(b.protocol); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, gNames]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const thClass = (key: SortKey) =>
    `px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors hover:text-[var(--color-text-primary)] ${
      sortKey === key ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'
    }`;

  const visibleIds = sorted.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...visibleIds]));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (onBulkDeletePolicies) {
      onBulkDeletePolicies([...selected]);
    }
    setSelected(new Set());
    setShowConfirm(false);
  };

  const selectionCount = selected.size;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Policy List
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {sorted.length === topology.policies.length
              ? `${topology.policies.length} policies, sorted by ${sortKey}`
              : `${sorted.length} of ${topology.policies.length} policies`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border px-2 py-1" style={{ backgroundColor: 'var(--color-input-bg)', borderColor: search ? 'var(--color-accent-blue)' : 'var(--color-input-border)' }}>
            <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter policies…"
              className="w-40 text-xs bg-transparent outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="p-0.5 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
                <X size={10} />
              </button>
            )}
          </div>
          <button
            onClick={() => onSelectPolicy('__new__')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Plus size={12} />
            New Policy
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {topology.policies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-12 h-12 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-4">
              <List size={24} className="text-[var(--color-text-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No policies yet</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-xs">
              Create your first policy to start controlling traffic between SmartGroups.
            </p>
            <button
              onClick={() => onSelectPolicy('__new__')}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Plus size={14} />
              Create Policy
            </button>
          </div>
        ) : sorted.length === 0 ? (
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
                {onBulkDeletePolicies && (
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                      onChange={toggleSelectAll}
                      className="cursor-pointer accent-[var(--color-aviatrix)]"
                      aria-label="Select all visible policies"
                    />
                  </th>
                )}
                <th onClick={() => handleSort('priority')} className={thClass('priority')}>
                  <span className="flex items-center gap-1">#<SortIcon active={sortKey === 'priority'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('name')} className={thClass('name')}>
                  <span className="flex items-center gap-1">Name<SortIcon active={sortKey === 'name'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('src')} className={thClass('src')}>
                  <span className="flex items-center gap-1">Source<SortIcon active={sortKey === 'src'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('dst')} className={thClass('dst')}>
                  <span className="flex items-center gap-1">Destination<SortIcon active={sortKey === 'dst'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('action')} className={thClass('action')}>
                  <span className="flex items-center gap-1">Action<SortIcon active={sortKey === 'action'} dir={sortDir} /></span>
                </th>
                <th onClick={() => handleSort('protocol')} className={thClass('protocol')}>
                  <span className="flex items-center gap-1">Protocol / Ports<SortIcon active={sortKey === 'protocol'} dir={sortDir} /></span>
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] whitespace-nowrap">
                  Flags
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isSelected = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => onSelectPolicy(p.id, p.srcGroupId[0], p.dstGroupId[0])}
                    className="border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors hover:bg-[var(--color-surface-elevated)]"
                    style={{
                      backgroundColor: isSelected
                        ? 'var(--color-accent-blue)18'
                        : i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                    }}
                  >
                    {onBulkDeletePolicies && (
                      <td className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleRow(p.id)}
                          className="cursor-pointer accent-[var(--color-aviatrix)]"
                          aria-label={`Select policy ${p.name}`}
                        />
                      </td>
                    )}
                    {/* Priority */}
                    <td className="px-3 py-2 font-mono font-bold text-[var(--color-text-muted)] whitespace-nowrap">
                      {p.priority}
                    </td>

                    {/* Name */}
                    <td className="px-3 py-2 font-medium text-[var(--color-text-primary)] max-w-[200px]">
                      <span className="block truncate">{p.name}</span>
                    </td>

                    {/* Source */}
                    <td className="px-3 py-2 text-[var(--color-text-secondary)] max-w-[160px]">
                      <span className="block truncate">{gNames(p.srcGroupId)}</span>
                      {p.srcExcludeGroupIds && p.srcExcludeGroupIds.length > 0 && (
                        <span className="text-[9px] text-[var(--color-accent-red)]">
                          excl. {p.srcExcludeGroupIds.map(gName).join(', ')}
                        </span>
                      )}
                    </td>

                    {/* Destination */}
                    <td className="px-3 py-2 text-[var(--color-text-secondary)] max-w-[160px]">
                      <span className="block truncate">{gNames(p.dstGroupId)}</span>
                      {p.dstExcludeGroupIds && p.dstExcludeGroupIds.length > 0 && (
                        <span className="text-[9px] text-[var(--color-accent-red)]">
                          excl. {p.dstExcludeGroupIds.map(gName).join(', ')}
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ActionBadge action={p.action} />
                    </td>

                    {/* Protocol / Ports */}
                    <td className="px-3 py-2 font-mono text-[var(--color-text-secondary)] whitespace-nowrap">
                      {p.protocol.toUpperCase()}
                      {p.ports ? <span className="text-[var(--color-text-muted)">/{p.ports}</span> : null}
                    </td>

                    {/* Flags */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {p.decrypt && (
                          <span title="TLS Decrypt">
                            <Lock size={11} className="text-[var(--color-accent-purple)]" />
                          </span>
                        )}
                        {(p.threatGroup || p.geoGroup) && (
                          <span title={p.threatGroup ? 'Threat group' : 'Geo group'}>
                            <Globe size={11} className="text-[var(--color-accent-amber)]" />
                          </span>
                        )}
                        {((p.srcExcludeGroupIds?.length ?? 0) > 0 || (p.dstExcludeGroupIds?.length ?? 0) > 0) && (
                          <span title="Has exclusions">
                            <Ban size={11} className="text-[var(--color-accent-red)]" />
                          </span>
                        )}
                        {p.logging && (
                          <span title="Logging enabled" className="text-[9px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-elevated)] px-1 rounded">
                            log
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
      {selectionCount > 0 && onBulkDeletePolicies && (
        <div
          className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        >
          <span className="text-xs text-[var(--color-text-secondary)] font-medium">
            {selectionCount} {selectionCount === 1 ? 'policy' : 'policies'} selected
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
          title={`Delete ${selectionCount} ${selectionCount === 1 ? 'policy' : 'policies'}?`}
          message={`This will permanently remove ${selectionCount} ${selectionCount === 1 ? 'policy' : 'policies'}. This action cannot be undone.`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
