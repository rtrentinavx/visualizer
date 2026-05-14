import { useEffect, useMemo, useState } from 'react';
import { X, History, Clock, Bookmark, Trash2, RotateCcw, Plus, AlertTriangle } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import {
  loadHistory,
  appendSnapshot,
  deleteSnapshot,
  sortNewestFirst,
  type Snapshot,
  type History as SnapshotHistory,
} from '../../lib/historyStorage';
import { diffTopologies, type TopologyDiff } from '../../lib/topologyDiff';
import { TopologyDiffSections, DiffTotalsBadges } from '../diff/TopologyDiffView';

interface HistoryModalProps {
  /** The current in-memory topology — used to compose a virtual "current" baseline. */
  currentTopology: DcfPolicyModel;
  /** Restore the topology shown in `snapshot` into the live app state. */
  onRestore: (topology: DcfPolicyModel) => void;
  onClose: () => void;
}

/**
 * History + diff modal. Lists every snapshot (newest first); selecting one
 * shows what changed between it and its immediate predecessor (default
 * baseline per design review). Restore = checkout — no auto-backup; the user
 * gets a confirmation prompt.
 *
 * Manual snapshots are visually distinguished and survive ring-buffer pruning
 * longer than autos.
 */
export default function HistoryModal({ currentTopology, onRestore, onClose }: HistoryModalProps) {
  const [history, setHistory] = useState<SnapshotHistory>({ snapshots: [] });
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [savingLabel, setSavingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');

  useEffect(() => {
    loadHistory().then((h) => {
      setHistory(h);
      setLoaded(true);
      const sorted = sortNewestFirst(h.snapshots);
      if (sorted.length > 0) setSelectedId(sorted[0]!.id);
    }).catch(() => setLoaded(true));
  }, []);

  const sortedSnapshots = useMemo(() => sortNewestFirst(history.snapshots), [history]);
  const selected = useMemo(
    () => sortedSnapshots.find((s) => s.id === selectedId) ?? null,
    [sortedSnapshots, selectedId],
  );

  // Default diff baseline = the snapshot immediately *prior* in time
  // (oldest-direction neighbor). For the very oldest snapshot we have no
  // prior; fall back to an empty diff against itself so the panel still
  // renders something sensible.
  const baseline = useMemo<DcfPolicyModel | null>(() => {
    if (!selected) return null;
    const idx = sortedSnapshots.findIndex((s) => s.id === selected.id);
    // sortedSnapshots is newest-first, so the prior snapshot is at idx+1.
    const prior = sortedSnapshots[idx + 1];
    return prior ? prior.topology : null;
  }, [selected, sortedSnapshots]);

  const diff = useMemo<TopologyDiff | null>(() => {
    if (!selected) return null;
    if (!baseline) return null;
    return diffTopologies(baseline, selected.topology);
  }, [selected, baseline]);

  const handleSaveManual = async () => {
    const label = labelDraft.trim() || 'Manual snapshot';
    const next = await appendSnapshot(currentTopology, 'manual', label);
    setHistory(next);
    setSavingLabel(false);
    setLabelDraft('');
    // Auto-select the freshly-added snapshot.
    const sorted = sortNewestFirst(next.snapshots);
    if (sorted[0]) setSelectedId(sorted[0].id);
  };

  const handleDelete = async (id: string) => {
    const next = await deleteSnapshot(id);
    setHistory(next);
    if (selectedId === id) {
      const sorted = sortNewestFirst(next.snapshots);
      setSelectedId(sorted[0]?.id ?? null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <History size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Version History</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {sortedSnapshots.length} snapshot{sortedSnapshots.length === 1 ? '' : 's'} · auto-pruned to 20
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSavingLabel(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--color-surface-elevated)]"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            >
              <Plus size={14} />
              Save snapshot
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
              <X size={16} />
            </button>
          </div>
        </div>

        {savingLabel && (
          <div
            className="px-4 py-2 border-b flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
          >
            <Bookmark size={14} className="text-[var(--color-accent-blue)] shrink-0" />
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveManual();
                if (e.key === 'Escape') { setSavingLabel(false); setLabelDraft(''); }
              }}
              placeholder="Label (e.g., before-prod-rollout)"
              className="flex-1 px-2 py-1 text-xs rounded border bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            />
            <button
              onClick={handleSaveManual}
              className="px-3 py-1 rounded-md text-xs font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              Save
            </button>
            <button
              onClick={() => { setSavingLabel(false); setLabelDraft(''); }}
              className="px-3 py-1 rounded-md text-xs font-medium border"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {/* Left pane — snapshot list */}
          <div
            className="w-72 shrink-0 border-r overflow-y-auto"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            {!loaded ? (
              <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>
            ) : sortedSnapshots.length === 0 ? (
              <div className="p-4 text-xs text-[var(--color-text-muted)]">
                No snapshots yet. Edit your topology to trigger an automatic snapshot, or use "Save snapshot" above to capture the current state with a label.
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                {sortedSnapshots.map((snap) => (
                  <SnapshotRow
                    key={snap.id}
                    snap={snap}
                    selected={snap.id === selectedId}
                    onSelect={() => setSelectedId(snap.id)}
                    onDelete={() => handleDelete(snap.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Right pane — diff view */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <DiffPane
                snap={selected}
                diff={diff}
                baselineExists={baseline !== null}
                onRestore={() => setConfirmRestoreId(selected.id)}
              />
            ) : (
              <div className="p-6 text-xs text-[var(--color-text-muted)]">Select a snapshot to see what changed.</div>
            )}
          </div>
        </div>

        {confirmRestoreId && (
          <RestoreConfirm
            onCancel={() => setConfirmRestoreId(null)}
            onConfirm={() => {
              const snap = sortedSnapshots.find((s) => s.id === confirmRestoreId);
              if (snap) onRestore(snap.topology);
              setConfirmRestoreId(null);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function SnapshotRow({
  snap,
  selected,
  onSelect,
  onDelete,
}: {
  snap: Snapshot;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const date = new Date(snap.createdAt);
  return (
    <li>
      <button
        onClick={onSelect}
        className="w-full text-left px-3 py-2.5 group flex items-start gap-2 transition-colors"
        style={{
          backgroundColor: selected ? 'var(--color-surface-elevated)' : 'transparent',
          borderLeft: selected ? '2px solid var(--color-accent-blue)' : '2px solid transparent',
        }}
      >
        {snap.kind === 'manual' ? (
          <Bookmark size={14} className="shrink-0 mt-0.5 text-[var(--color-accent-blue)]" />
        ) : (
          <Clock size={14} className="shrink-0 mt-0.5 text-[var(--color-text-muted)]" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">
            {snap.label ?? (snap.kind === 'manual' ? 'Manual snapshot' : 'Auto')}
          </p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-red-400 transition-opacity"
          title="Delete snapshot"
        >
          <Trash2 size={12} />
        </button>
      </button>
    </li>
  );
}

function DiffPane({
  snap,
  diff,
  baselineExists,
  onRestore,
}: {
  snap: Snapshot;
  diff: TopologyDiff | null;
  baselineExists: boolean;
  onRestore: () => void;
}) {
  const date = new Date(snap.createdAt);

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-4 py-3 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--color-border-subtle)' }}
      >
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {snap.label ?? (snap.kind === 'manual' ? 'Manual snapshot' : 'Auto snapshot')}
          </p>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            {date.toLocaleString()}
          </p>
        </div>
        <button
          onClick={onRestore}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--color-aviatrix)' }}
        >
          <RotateCcw size={14} />
          Restore
        </button>
      </div>

      <div className="flex-1 p-4 space-y-3 overflow-y-auto">
        {!baselineExists ? (
          <div
            className="rounded-lg border p-3 flex items-start gap-2 text-xs"
            style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}
          >
            <AlertTriangle size={14} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />
            <span className="text-[var(--color-text-muted)]">
              This is the oldest snapshot in history; no earlier snapshot exists to diff against.
            </span>
          </div>
        ) : !diff ? null : diff.isEmpty ? (
          <div className="text-xs text-[var(--color-text-muted)] py-6 text-center">
            No changes from the previous snapshot.
          </div>
        ) : (
          <>
            <DiffTotalsBadges diff={diff} />
            <TopologyDiffSections diff={diff} />
          </>
        )}
      </div>
    </div>
  );
}

function RestoreConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-sm rounded-xl border shadow-2xl p-5"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Restore this snapshot?</h3>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Your current topology will be replaced with the contents of the selected snapshot. The next automatic save will capture the restored state — your prior state remains in earlier snapshots.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium border"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
