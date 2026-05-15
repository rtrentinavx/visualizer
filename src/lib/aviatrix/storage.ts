import { encryptTopology, decryptTopology } from '../cryptoStorage';
import type {
  AviatrixSettings,
  AviatrixConnection,
  AviatrixConnectionMCP,
  AviatrixConnectionAPI,
  AviatrixConnectionStatus,
} from './types';

const STORAGE_KEY = 'dcf-aviatrix-settings-v1';

const TOKEN_EXPIRY_SLOP_MS = 60_000;

/**
 * Migrate a raw connection object loaded from localStorage. Older entries
 * pre-date the `connectionType` discriminator — default them to 'mcp'.
 */
function migrateConnection(raw: Record<string, unknown>): AviatrixConnection {
  if (!raw.connectionType) raw.connectionType = 'mcp';
  return raw as unknown as AviatrixConnection;
}

function isValidAviatrixSettings(value: unknown): value is AviatrixSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.connections)) return false;
  if (typeof v.activeConnectionId !== 'string' && v.activeConnectionId !== null) return false;

  // Migrate connections in place before the type guard finalises.
  v.connections = (v.connections as unknown[]).map((c) => {
    if (c && typeof c === 'object') return migrateConnection(c as Record<string, unknown>);
    return c;
  });

  return true;
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
  if (c.connectionType === 'api') {
    if (!c.username || !c.password) return 'disconnected';
    // 'connected' only after a successful Test (connectedAt is set by handleTestApi on success).
    return c.connectedAt ? 'connected' : 'configured';
  }
  // MCP — token-based.
  if (!c.accessToken) return 'disconnected';
  if (c.expiresAt !== undefined && c.expiresAt - TOKEN_EXPIRY_SLOP_MS <= now) return 'expired';
  return 'connected';
}

/**
 * Apply a token-grant response from the OAuth dance to an MCP connection.
 * Pure; returns a new AviatrixConnectionMCP. Caller persists.
 */
export function applyTokenGrant(
  c: AviatrixConnectionMCP,
  grant: { accessToken: string; refreshToken?: string; expiresIn?: number },
  now: number = Date.now(),
): AviatrixConnectionMCP {
  return {
    ...c,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken ?? c.refreshToken,
    expiresAt: grant.expiresIn !== undefined ? now + grant.expiresIn * 1000 : undefined,
    connectedAt: now,
  };
}

/** Wipe the post-OAuth state but keep the OAuth client config — equivalent to "Disconnect" in the UI. */
export function clearConnectionTokens(c: AviatrixConnectionMCP): AviatrixConnectionMCP {
  return {
    id: c.id,
    name: c.name,
    connectionType: 'mcp',
    mcpBaseUrl: c.mcpBaseUrl,
    authEndpoint: c.authEndpoint,
    tokenEndpoint: c.tokenEndpoint,
    clientId: c.clientId,
    scope: c.scope,
    lastFetchAt: c.lastFetchAt,
  };
}

/** Type guards for consumers that need to narrow the union. */
export function isMcpConnection(c: AviatrixConnection): c is AviatrixConnectionMCP {
  return c.connectionType === 'mcp';
}
export function isApiConnection(c: AviatrixConnection): c is AviatrixConnectionAPI {
  return c.connectionType === 'api';
}
