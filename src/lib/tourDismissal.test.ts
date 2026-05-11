import { describe, it, expect, beforeEach } from 'vitest';
import {
  isTourCompleted,
  markTourCompleted,
  wasTourAutoShown,
  markTourAutoShown,
  clearTourFlags,
} from './tourDismissal';

// Tiny in-memory localStorage shim — the file's helpers all live behind
// try/catch, so a real-browser localStorage isn't required to exercise them.
class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

beforeEach(() => {
  // Reset between tests.
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('tourDismissal', () => {
  it('isTourCompleted is false by default', () => {
    expect(isTourCompleted()).toBe(false);
  });

  it('markTourCompleted persists across reads', () => {
    markTourCompleted();
    expect(isTourCompleted()).toBe(true);
  });

  it('wasTourAutoShown is false until marked', () => {
    expect(wasTourAutoShown()).toBe(false);
    markTourAutoShown();
    expect(wasTourAutoShown()).toBe(true);
  });

  it('clearTourFlags resets both flags', () => {
    markTourCompleted();
    markTourAutoShown();
    clearTourFlags();
    expect(isTourCompleted()).toBe(false);
    expect(wasTourAutoShown()).toBe(false);
  });
});
