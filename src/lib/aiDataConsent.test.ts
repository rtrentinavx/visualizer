import { describe, it, expect, beforeEach } from 'vitest';
import { hasAIDataConsent, grantAIDataConsent, revokeAIDataConsent } from './aiDataConsent';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('aiDataConsent', () => {
  it('defaults to false', () => {
    expect(hasAIDataConsent()).toBe(false);
  });

  it('grant + has', () => {
    grantAIDataConsent();
    expect(hasAIDataConsent()).toBe(true);
  });

  it('revoke clears the flag', () => {
    grantAIDataConsent();
    revokeAIDataConsent();
    expect(hasAIDataConsent()).toBe(false);
  });
});
