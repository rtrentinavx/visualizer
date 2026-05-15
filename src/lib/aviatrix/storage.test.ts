import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import {
  saveAviatrixSettings,
  loadAviatrixSettings,
  clearAviatrixSettings,
  getDefaultAviatrixSettings,
  getActiveConnection,
  getConnectionStatus,
  applyTokenGrant,
  clearConnectionTokens,
} from './storage';
import type { AviatrixConnectionMCP, AviatrixSettings } from './types';

const baseConnection = (overrides: Partial<AviatrixConnectionMCP> = {}): AviatrixConnectionMCP => ({
  id: 'c1',
  name: 'Test',
  connectionType: 'mcp',
  mcpBaseUrl: 'https://controller.example.com/mcp',
  authEndpoint: 'https://controller.example.com/oauth/authorize',
  tokenEndpoint: 'https://controller.example.com/oauth/token',
  clientId: 'dcf-visualizer',
  scope: 'mcp:read',
  ...overrides,
});

/**
 * Minimal in-memory `localStorage` shim. Vitest runs in the `node` env (see
 * vite.config.ts) so the real DOM Storage isn't available. We only need
 * getItem/setItem/removeItem for the storage round-trip; the encrypt/decrypt
 * path uses Web Crypto which IS available in Node 20+.
 */
function installLocalStorageShim(): void {
  // Always replace — Node may expose a partial Storage that's missing
  // methods we need (e.g. removeItem). We want our shim, full stop.
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

describe('aviatrix storage', () => {
  beforeAll(() => {
    installLocalStorageShim();
  });

  beforeEach(() => {
    clearAviatrixSettings();
  });

  it('round-trips an encrypted save/load', async () => {
    const settings: AviatrixSettings = {
      activeConnectionId: 'c1',
      connections: [baseConnection({ accessToken: 'access-xyz', refreshToken: 'refresh-abc', expiresAt: Date.now() + 60_000 })],
    };
    await saveAviatrixSettings(settings);
    const loaded = await loadAviatrixSettings();
    expect(loaded).toEqual(settings);
  });

  it('returns null when nothing is stored', async () => {
    const loaded = await loadAviatrixSettings();
    expect(loaded).toBeNull();
  });

  it('default settings have no active connection', () => {
    const d = getDefaultAviatrixSettings();
    expect(d.activeConnectionId).toBeNull();
    expect(d.connections).toEqual([]);
    expect(getActiveConnection(d)).toBeNull();
  });

  it('getActiveConnection resolves the active id to the connection object', () => {
    const c = baseConnection();
    const settings: AviatrixSettings = { activeConnectionId: 'c1', connections: [c] };
    expect(getActiveConnection(settings)).toEqual(c);
  });

  it('getActiveConnection returns null when the active id points nowhere', () => {
    const settings: AviatrixSettings = { activeConnectionId: 'gone', connections: [baseConnection()] };
    expect(getActiveConnection(settings)).toBeNull();
  });

  describe('getConnectionStatus', () => {
    it('returns disconnected for a connection with no accessToken', () => {
      expect(getConnectionStatus(baseConnection())).toBe('disconnected');
    });

    it('returns disconnected for null', () => {
      expect(getConnectionStatus(null)).toBe('disconnected');
    });

    it('returns connected when the token is well within its expiry window', () => {
      const now = 1_000_000_000_000;
      const c = baseConnection({ accessToken: 't', expiresAt: now + 600_000 }); // 10 min ahead
      expect(getConnectionStatus(c, now)).toBe('connected');
    });

    it('returns expired when the token is within 60s of expiry (slop)', () => {
      const now = 1_000_000_000_000;
      const c = baseConnection({ accessToken: 't', expiresAt: now + 30_000 }); // 30 s ahead → in slop
      expect(getConnectionStatus(c, now)).toBe('expired');
    });

    it('treats undefined expiresAt as never-expiring', () => {
      const c = baseConnection({ accessToken: 't' });
      expect(getConnectionStatus(c)).toBe('connected');
    });
  });

  describe('applyTokenGrant', () => {
    it('writes the access token + expiry derived from expires_in', () => {
      const now = 1_000_000_000_000;
      const c = baseConnection();
      const next = applyTokenGrant(c, { accessToken: 'a', refreshToken: 'r', expiresIn: 3600 }, now);
      expect(next.accessToken).toBe('a');
      expect(next.refreshToken).toBe('r');
      expect(next.expiresAt).toBe(now + 3_600_000);
      expect(next.connectedAt).toBe(now);
    });

    it('preserves the prior refreshToken when the grant only returned an access token', () => {
      const c = baseConnection({ refreshToken: 'prior' });
      const next = applyTokenGrant(c, { accessToken: 'fresh' });
      expect(next.refreshToken).toBe('prior');
    });
  });

  describe('clearConnectionTokens', () => {
    it('drops the token fields but keeps the OAuth client config intact', () => {
      const c = baseConnection({ accessToken: 'a', refreshToken: 'r', expiresAt: 123, connectedAt: 456 });
      const cleared = clearConnectionTokens(c);
      expect(cleared.accessToken).toBeUndefined();
      expect(cleared.refreshToken).toBeUndefined();
      expect(cleared.expiresAt).toBeUndefined();
      expect(cleared.connectedAt).toBeUndefined();
      // OAuth client config retained.
      expect(cleared.clientId).toBe(c.clientId);
      expect(cleared.authEndpoint).toBe(c.authEndpoint);
      expect(cleared.tokenEndpoint).toBe(c.tokenEndpoint);
    });
  });
});
