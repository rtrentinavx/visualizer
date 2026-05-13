import type { AviatrixConnection } from './types';

/**
 * Client-side PKCE helpers + the Connect flow.
 *
 * Flow on click of "Connect" in the UI:
 *   1. Generate code_verifier (random) + code_challenge (SHA-256(verifier)).
 *   2. Generate a state nonce (CSRF protection).
 *   3. Stash { codeVerifier, state, tokenEndpoint, clientId, connectionId } in
 *      sessionStorage so the callback page can read it back. (Encrypted-
 *      localStorage isn't accessible from the static callback page.)
 *   4. Redirect the browser to the customer's authEndpoint with the standard
 *      OAuth params. The user logs in on their Controller, gets redirected
 *      back to /auth/aviatrix/callback.html.
 *   5. The callback page extracts the `code` + `state` from the URL, validates
 *      state, reads the stash, POSTs to /api/aviatrix/oauth-token with the
 *      code + verifier. The proxy talks to the customer's tokenEndpoint.
 *   6. Callback writes the resulting tokens to a localStorage handoff key
 *      and redirects to /. The main app on mount picks up the handoff,
 *      applies the grant to the connection profile (encrypted), and clears
 *      the handoff key.
 */

export const PENDING_AUTH_KEY = 'dcf-aviatrix-oauth-pending';
export const HANDOFF_KEY = 'dcf-aviatrix-oauth-handoff';

export interface PendingAuth {
  connectionId: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  /** Stashed here so the static callback page can call the proxy without decrypting localStorage. */
  tokenEndpoint: string;
  clientId: string;
  startedAt: number;
}

export interface OAuthHandoff {
  connectionId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  receivedAt: number;
}

/** Encode bytes as base64url (RFC 4648 §5) — no padding, URL-safe alphabet. */
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Random 48-byte verifier → 64 base64url chars. RFC 7636 allows 43-128 chars. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/** code_challenge = base64url(SHA-256(verifier)), method = S256. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hash));
}

/** 16-byte random nonce used as the OAuth `state` param (CSRF guard). */
export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/** Compute the redirect URI from the current origin. Same for every connection. */
export function getRedirectUri(origin: string = window.location.origin): string {
  return `${origin}/auth/aviatrix/callback.html`;
}

/**
 * Kick off the OAuth dance. Stashes PKCE state in sessionStorage and navigates
 * to the customer's authEndpoint. Does NOT resolve — the browser navigates
 * away. The caller should treat this as a fire-and-forget.
 */
export async function initiateConnect(connection: AviatrixConnection): Promise<void> {
  if (!connection.authEndpoint || !connection.tokenEndpoint || !connection.clientId) {
    throw new Error('Connection is missing OAuth client config (authEndpoint / tokenEndpoint / clientId).');
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);
  const state = generateState();
  const redirectUri = getRedirectUri();

  const pending: PendingAuth = {
    connectionId: connection.id,
    codeVerifier,
    state,
    redirectUri,
    tokenEndpoint: connection.tokenEndpoint,
    clientId: connection.clientId,
    startedAt: Date.now(),
  };
  sessionStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(pending));

  const url = new URL(connection.authEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', connection.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (connection.scope) url.searchParams.set('scope', connection.scope);

  window.location.href = url.toString();
}

/**
 * If the OAuth callback page wrote a handoff blob to localStorage, return it
 * and clear the key. Returns null when no handoff is present. Caller (main
 * app on mount) is responsible for applying the grant to the matching
 * connection in encrypted storage.
 */
export function consumeOAuthHandoff(): OAuthHandoff | null {
  const raw = localStorage.getItem(HANDOFF_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthHandoff;
    localStorage.removeItem(HANDOFF_KEY);
    if (!parsed.connectionId || !parsed.accessToken) return null;
    return parsed;
  } catch {
    localStorage.removeItem(HANDOFF_KEY);
    return null;
  }
}

/**
 * Server-side response shape from /api/aviatrix/oauth-token. Mirrors the
 * standard OAuth 2.0 token response (RFC 6749 §5.1) with camelCase keys.
 */
export interface TokenGrantResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface TokenGrantError {
  error: string;
}

/** Refresh an expired access token. Used by Phase 2's MCP client before each call. */
export async function refreshTokens(params: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}): Promise<TokenGrantResponse | TokenGrantError> {
  const r = await fetch('/api/aviatrix/oauth-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'refresh_token',
      tokenEndpoint: params.tokenEndpoint,
      clientId: params.clientId,
      refreshToken: params.refreshToken,
    }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    return { error: err.error ?? `HTTP ${r.status}` };
  }
  return (await r.json()) as TokenGrantResponse;
}
