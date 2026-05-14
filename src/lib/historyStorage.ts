import type { DcfPolicyModel } from '../types/dcf';
import { encryptTopology, decryptTopology } from './cryptoStorage';

/**
 * Snapshot history — encrypted ring buffer of recent topology states. The
 * autosave path (useTopology) appends an `auto` snapshot whenever the topology
 * changes; users can also create `manual` snapshots with a label from the
 * History modal. Both share the same storage; when the ring overflows the cap,
 * auto snapshots get pruned first so manual ones (the "milestones") survive
 * longer.
 *
 * v1 storage decisions per design review:
 * - Cap 20 snapshots total. Auto-pruned FIFO with manual preferred.
 * - Same AES-GCM crypto + localStorage key pattern as AI settings / aviatrix
 *   connections; the topology itself is also encrypted, so snapshots leak no
 *   more than the live state does.
 */

const STORAGE_KEY = 'dcf-history-v1';
export const HISTORY_LIMIT = 20;

export type SnapshotKind = 'auto' | 'manual';

export interface Snapshot {
  id: string;
  /** Unix epoch ms when the snapshot was created. */
  createdAt: number;
  /** 'auto' = created by the autosave hook. 'manual' = user-initiated. */
  kind: SnapshotKind;
  /** Optional label (manual snapshots only). */
  label?: string;
  /** The full topology at the time of the snapshot. */
  topology: DcfPolicyModel;
}

export interface History {
  snapshots: Snapshot[];
}

function isValidHistory(v: unknown): v is History {
  if (!v || typeof v !== 'object') return false;
  return Array.isArray((v as Record<string, unknown>).snapshots);
}

function genId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function saveHistory(history: History): Promise<void> {
  const encrypted = await encryptTopology(history);
  localStorage.setItem(STORAGE_KEY, encrypted);
}

export async function loadHistory(): Promise<History> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { snapshots: [] };
    const decrypted = await decryptTopology<unknown>(STORAGE_KEY);
    if (isValidHistory(decrypted)) return decrypted;
    return { snapshots: [] };
  } catch {
    return { snapshots: [] };
  }
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Trim the snapshot list down to HISTORY_LIMIT, dropping `auto` snapshots
 * first (oldest auto first), and only touching `manual` snapshots if every
 * remaining entry is manual.
 */
export function pruneToLimit(snapshots: Snapshot[], limit: number = HISTORY_LIMIT): Snapshot[] {
  if (snapshots.length <= limit) return snapshots;
  // Sort the deletion candidates: auto first (oldest first), then manual (oldest first).
  // We DELETE from the head of this sorted list until we're at the limit.
  const sorted = [...snapshots].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'auto' ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
  const toDrop = new Set(sorted.slice(0, snapshots.length - limit).map((s) => s.id));
  return snapshots.filter((s) => !toDrop.has(s.id));
}

/**
 * Append a snapshot. Dedup against the immediately-previous one — if the
 * topology hashes to the same JSON, skip (avoids ring noise when the user
 * triggers many no-op saves). Manual snapshots are NEVER deduped.
 */
export async function appendSnapshot(
  topology: DcfPolicyModel,
  kind: SnapshotKind,
  label?: string,
): Promise<History> {
  const history = await loadHistory();
  const prior = history.snapshots[history.snapshots.length - 1];

  if (kind === 'auto' && prior) {
    if (JSON.stringify(prior.topology) === JSON.stringify(topology)) {
      return history; // no-op; same as the most recent snapshot
    }
  }

  const snap: Snapshot = {
    id: genId(),
    createdAt: Date.now(),
    kind,
    label,
    topology,
  };
  const nextSnapshots = pruneToLimit([...history.snapshots, snap]);
  const next: History = { snapshots: nextSnapshots };
  await saveHistory(next);
  return next;
}

export async function deleteSnapshot(snapshotId: string): Promise<History> {
  const history = await loadHistory();
  const next: History = { snapshots: history.snapshots.filter((s) => s.id !== snapshotId) };
  await saveHistory(next);
  return next;
}

/**
 * Get all snapshots in newest-first order (the order the UI typically wants).
 */
export function sortNewestFirst(snapshots: Snapshot[]): Snapshot[] {
  return [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
}
