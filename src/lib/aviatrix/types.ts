/**
 * A configured live link to a customer's Aviatrix Controller.
 *
 * Two authentication modes:
 *   - 'mcp'  (default for existing entries) — OAuth PKCE → Controller MCP server.
 *   - 'api'  — Username/password → Controller REST API (v2.5 preferred, v1 fallback).
 *
 * Multi-connection is supported but only one can be active at a time.
 * Tokens/passwords are stored encrypted at rest — same AES-GCM path as AI keys.
 */

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------
interface AviatrixConnectionBase {
  id: string;
  /** User-friendly label, e.g. "Customer Prod Controller". */
  name: string;
  /** Unix epoch ms of the most recent successful Connect / Test. */
  connectedAt?: number;
  /** Unix epoch ms of the most recent successful topology fetch. */
  lastFetchAt?: number;
}

// ---------------------------------------------------------------------------
// MCP connection — OAuth PKCE → MCP server
// ---------------------------------------------------------------------------
export interface AviatrixConnectionMCP extends AviatrixConnectionBase {
  connectionType: 'mcp';
  /** MCP server endpoint exposed by the Controller (e.g. https://controller.customer.com/mcp). */
  mcpBaseUrl: string;
  /** Authorization endpoint — where we redirect the browser to start the PKCE flow. */
  authEndpoint: string;
  /** Token endpoint — where the code is exchanged for tokens (proxied via /api/aviatrix). */
  tokenEndpoint: string;
  /** Client ID issued by the customer's Controller for this Visualizer install. */
  clientId: string;
  /** Optional space-separated OAuth scopes (e.g. "mcp:read dcf:read"). */
  scope?: string;
  /** Bearer token sent on every MCP call. Refreshed before expiry when possible. */
  accessToken?: string;
  /** Long-lived refresh token used to get a new accessToken without re-prompting login. */
  refreshToken?: string;
  /** Unix epoch ms when the current accessToken stops working. */
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Direct API connection — username/password → Controller REST API
// ---------------------------------------------------------------------------
export interface AviatrixConnectionAPI extends AviatrixConnectionBase {
  connectionType: 'api';
  /** Base URL of the Controller (e.g. https://controller.example.com). */
  controllerBaseUrl: string;
  /** Controller admin (or read-only) username. */
  username: string;
  /** Controller password — encrypted at rest via cryptoStorage. */
  password: string;
  /** Outbound IP observed by the proxy during the last successful Test — the IP the customer must allow-list. */
  egressIp?: string;
}

// ---------------------------------------------------------------------------
// Union + settings
// ---------------------------------------------------------------------------
export type AviatrixConnection = AviatrixConnectionMCP | AviatrixConnectionAPI;

export interface AviatrixSettings {
  /** The connection currently selected for live import. Null when none. */
  activeConnectionId: string | null;
  connections: AviatrixConnection[];
}

/**
 * Connection status derived from the token/credential state — used by UI badges.
 * 'configured' is API-only: credentials are saved but no successful Test has been run yet.
 */
export type AviatrixConnectionStatus = 'disconnected' | 'configured' | 'connected' | 'expired';
