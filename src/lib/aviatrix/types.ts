/**
 * A configured live link to a customer's Aviatrix Controller. Each connection
 * encapsulates the OAuth client config (issued/registered by the customer on
 * their Controller side) AND the post-auth token pair we obtained via the
 * PKCE flow. Tokens are stored encrypted at rest with the same AES-GCM key as
 * AI keys — see `src/lib/cryptoStorage.ts`.
 *
 * Multi-connection is supported but only one can be active at a time. The
 * active one is what the "Fetch from Aviatrix Live" import button calls.
 */
export interface AviatrixConnection {
  id: string;
  /** User-friendly label, e.g. "Customer Prod Controller". */
  name: string;

  /** MCP server endpoint exposed by the Controller (e.g. https://controller.customer.com/mcp). */
  mcpBaseUrl: string;

  // ---- OAuth client config (set up once when creating the connection) ----
  /** Authorization endpoint — where we redirect the browser to start the PKCE flow. */
  authEndpoint: string;
  /** Token endpoint — where the code is exchanged for tokens (proxied via /api/aviatrix). */
  tokenEndpoint: string;
  /** Client ID issued by the customer's Controller for this Visualizer install. */
  clientId: string;
  /** Optional space-separated OAuth scopes (e.g. "mcp:read dcf:read"). */
  scope?: string;

  // ---- Post-OAuth state (filled after a successful Connect) ----
  /** Bearer token sent on every MCP call. Refreshed before expiry when possible. */
  accessToken?: string;
  /** Long-lived refresh token used to get a new accessToken without re-prompting login. */
  refreshToken?: string;
  /** Unix epoch ms when the current accessToken stops working. */
  expiresAt?: number;

  // ---- Telemetry / display ----
  /** Unix epoch ms of the most recent successful Connect. */
  connectedAt?: number;
  /** Unix epoch ms of the most recent successful topology fetch. */
  lastFetchAt?: number;
}

export interface AviatrixSettings {
  /** The connection currently selected for live import. Null when none. */
  activeConnectionId: string | null;
  connections: AviatrixConnection[];
}

/** Connection status derived from the token state — used by UI badges. */
export type AviatrixConnectionStatus = 'disconnected' | 'connected' | 'expired';
