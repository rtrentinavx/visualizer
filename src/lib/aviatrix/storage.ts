import { encryptTopology, decryptTopology } from '../cryptoStorage';
import type { AviatrixSettings, AviatrixConnection, AviatrixConnectionStatus } from './types';

const STORAGE_KEY = 'dcf-aviatrix-settings-v1';

/**
 * 60 seconds of slop. We treat a token as expired this far ahead of its
 * advertised expiry so we don't issue a request that lands just after the
 * server-side expiry and gets a 401.
 */
const TOKEN_EXPIRY_SLOP_MS = 60_000;

function isValidAviatrixSettings(value: unknown): value is AviatrixSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.connections) &&
    (typeof v.activeConnectionId === 'string' || v.activeConnectionId === null)
  );
}

export async function saveAviatrixSettings(settings: AviatrixSettings): Promise<void> {
  const encrypted = await encryptTopology(settings);
  localStorage.setItem(STORAGE_KEY, encrypted);
}

export async function loadAviatrixSettings(): Promise<AviatrixSettings | null> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const decrypted = await decryptTopology<unknown>(STORAGE_KEY);
    if (isValidAviatrixSettings(decrypted)) return decrypted;

    // Plain-JSON fallback for any pre-encryption migration path.
    if (stored.startsWith('{')) {
      const parsed = JSON.parse(stored) as unknown;
      if (isValidAviatrixSettings(parsed)) {
        await saveAviatrixSettings(parsed);
        return parsed;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function clearAviatrixSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getDefaultAviatrixSettings(): AviatrixSettings {
  return {
    activeConnectionId: null,
    connections: [],
  };
}

export function getActiveConnection(settings: AviatrixSettings): AviatrixConnection | null {
  if (!settings.activeConnectionId) return null;
  return settings.connections.find((c) => c.id === settings.activeConnectionId) ?? null;
}

export function getConnectionStatus(c: AviatrixConnection | null, now: number = Date.now()): AviatrixConnectionStatus {
  if (!c) return 'disconnected';
  if (!c.accessToken) return 'disconnected';
  if (c.expiresAt !== undefined && c.expiresAt - TOKEN_EXPIRY_SLOP_MS <= now) return 'expired';
  return 'connected';
}

/**
 * Apply a token-grant response from the OAuth dance to a connection. Pure;
 * returns a new AviatrixConnection. Caller persists.
 */
export function applyTokenGrant(
  c: AviatrixConnection,
  grant: { accessToken: string; refreshToken?: string; expiresIn?: number },
  now: number = Date.now(),
): AviatrixConnection {
  return {
    ...c,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken ?? c.refreshToken,
    expiresAt: grant.expiresIn !== undefined ? now + grant.expiresIn * 1000 : undefined,
    connectedAt: now,
  };
}

/** Wipe the post-OAuth state but keep the OAuth client config — equivalent to "Disconnect" in the UI. */
export function clearConnectionTokens(c: AviatrixConnection): AviatrixConnection {
  return {
    id: c.id,
    name: c.name,
    mcpBaseUrl: c.mcpBaseUrl,
    authEndpoint: c.authEndpoint,
    tokenEndpoint: c.tokenEndpoint,
    clientId: c.clientId,
    scope: c.scope,
    lastFetchAt: c.lastFetchAt,
  };
}
