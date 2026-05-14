import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import {
  appendSnapshot,
  loadHistory,
  deleteSnapshot,
  clearHistory,
  pruneToLimit,
  sortNewestFirst,
  HISTORY_LIMIT,
  type Snapshot,
} from './historyStorage';
import type { DcfPolicyModel } from '../types/dcf';

function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
}

function fakeTopology(label: string): DcfPolicyModel {
  return {
    smartGroups: [{ id: `sg-${label}`, name: label, color: '#000', criteria: [], matchType: 'any' }],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

function makeSnap(kind: 'auto' | 'manual', createdAt: number, label?: string): Snapshot {
  return {
    id: `snap-${kind}-${createdAt}`,
    createdAt,
    kind,
    label,
    topology: fakeTopology(`t-${createdAt}`),
  };
}

describe('history storage', () => {
  beforeAll(() => installLocalStorageShim());
  beforeEach(() => clearHistory());

  it('appends a snapshot and reads it back', async () => {
    const t = fakeTopology('alpha');
    await appendSnapshot(t, 'auto');
    const history = await loadHistory();
    expect(history.snapshots).toHaveLength(1);
    expect(history.snapshots[0]!.kind).toBe('auto');
    expect(history.snapshots[0]!.topology).toEqual(t);
  });

  it('dedups auto snapshots when the topology is unchanged from the prior one', async () => {
    const t = fakeTopology('alpha');
    await appendSnapshot(t, 'auto');
    await appendSnapshot(t, 'auto'); // identical → should be skipped
    const history = await loadHistory();
    expect(history.snapshots).toHaveLength(1);
  });

  it('does NOT dedup manual snapshots even when the topology is identical', async () => {
    const t = fakeTopology('alpha');
    await appendSnapshot(t, 'auto');
    await appendSnapshot(t, 'manual', 'Milestone'); // identical content but manual → keep
    const history = await loadHistory();
    expect(history.snapshots).toHaveLength(2);
    expect(history.snapshots[1]!.label).toBe('Milestone');
  });

  it('deletes a snapshot by id', async () => {
    await appendSnapshot(fakeTopology('a'), 'auto');
    await appendSnapshot(fakeTopology('b'), 'auto');
    const before = await loadHistory();
    const targetId = before.snapshots[0]!.id;
    const after = await deleteSnapshot(targetId);
    expect(after.snapshots).toHaveLength(1);
    expect(after.snapshots[0]!.id).not.toBe(targetId);
  });

  describe('pruneToLimit', () => {
    it('keeps every snapshot when under the limit', () => {
      const snaps = [makeSnap('auto', 1), makeSnap('auto', 2), makeSnap('manual', 3)];
      expect(pruneToLimit(snaps, 5)).toEqual(snaps);
    });

    it('drops the oldest auto snapshot first when over the limit', () => {
      const snaps = [
        makeSnap('auto', 1),
        makeSnap('auto', 2),
        makeSnap('manual', 3, 'M1'),
        makeSnap('auto', 4),
      ];
      const pruned = pruneToLimit(snaps, 3);
      expect(pruned).toHaveLength(3);
      // Oldest auto (id snap-auto-1) is gone; manual is preserved.
      expect(pruned.find((s) => s.id === 'snap-auto-1')).toBeUndefined();
      expect(pruned.find((s) => s.label === 'M1')).toBeDefined();
    });

    it('only drops manual snapshots when there are no auto ones left to drop', () => {
      const snaps = [
        makeSnap('manual', 1, 'M1'),
        makeSnap('manual', 2, 'M2'),
        makeSnap('manual', 3, 'M3'),
      ];
      const pruned = pruneToLimit(snaps, 2);
      expect(pruned).toHaveLength(2);
      // Oldest manual is the one dropped.
      expect(pruned.find((s) => s.id === 'snap-manual-1')).toBeUndefined();
    });
  });

  it('honors HISTORY_LIMIT (20) when appending many snapshots', async () => {
    for (let i = 0; i < 25; i++) {
      await appendSnapshot(fakeTopology(`gen-${i}`), 'auto');
    }
    const history = await loadHistory();
    expect(history.snapshots).toHaveLength(HISTORY_LIMIT);
    // The five oldest got pruned; the newest remain.
    expect(history.snapshots[0]!.topology.smartGroups[0]!.name).toBe('gen-5');
    expect(history.snapshots[19]!.topology.smartGroups[0]!.name).toBe('gen-24');
  });

  it('sortNewestFirst returns descending by createdAt', () => {
    const snaps = [makeSnap('auto', 1), makeSnap('auto', 3), makeSnap('auto', 2)];
    const sorted = sortNewestFirst(snaps);
    expect(sorted.map((s) => s.createdAt)).toEqual([3, 2, 1]);
  });

  it('loadHistory returns an empty history when storage is untouched', async () => {
    const history = await loadHistory();
    expect(history.snapshots).toEqual([]);
  });
});
