import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithTimeout, isTimeoutError } from '../ai/_timeout.js';

/**
 * OAuth 2.0 token-exchange proxy for the Aviatrix Live Connector.
 *
 * Why proxy: the customer's Controller token endpoint won't include
 * `dcf-visualizer.vercel.app` in its CORS allowlist, so a direct browser POST
 * fails. We POST from server-side instead. Standard PKCE flow; no client
 * secret involved (public-client model).
 *
 * Two grant types supported:
 *   - authorization_code (initial code → tokens exchange, called from
 *     /auth/aviatrix/callback.html after the customer's Controller redirects
 *     back with `?code=...`).
 *   - refresh_token (used by Phase 2's MCP client before an expired call to
 *     get a fresh access_token without re-prompting the user).
 *
 * Request shape:
 *   { grantType: 'authorization_code', tokenEndpoint, clientId, code,
 *     codeVerifier, redirectUri }
 *   OR
 *   { grantType: 'refresh_token', tokenEndpoint, clientId, refreshToken }
 *
 * Response shape:
 *   { accessToken, refreshToken?, expiresIn? }
 *
 * Errors are returned as JSON `{ error: string }` with the upstream's HTTP
 * status. The same hardened outer try/catch pattern as `/api/ai/proxy`
 * ensures uncaught errors return 500 JSON, not FUNCTION_INVOCATION_FAILED.
 */

export const config = { maxDuration: 30 };

interface TokenRequest {
  grantType: 'authorization_code' | 'refresh_token';
  tokenEndpoint: string;
  clientId: string;
  // authorization_code only
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  // refresh_token only
  refreshToken?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body must be JSON.' });
    }
    const body = req.body as TokenRequest;

    if (!body.tokenEndpoint || !body.clientId) {
      return res.status(400).json({ error: 'Missing tokenEndpoint or clientId.' });
    }
    if (!isHttpUrl(body.tokenEndpoint)) {
      return res.status(400).json({ error: 'tokenEndpoint must be an http(s) URL.' });
    }

    // Build the standard application/x-www-form-urlencoded body per RFC 6749.
    const form = new URLSearchParams();
    form.set('client_id', body.clientId);

    if (body.grantType === 'authorization_code') {
      if (!body.code || !body.codeVerifier || !body.redirectUri) {
        return res.status(400).json({ error: 'authorization_code grant requires code, codeVerifier, redirectUri.' });
      }
      form.set('grant_type', 'authorization_code');
      form.set('code', body.code);
      form.set('code_verifier', body.codeVerifier);
      form.set('redirect_uri', body.redirectUri);
    } else if (body.grantType === 'refresh_token') {
      if (!body.refreshToken) {
        return res.status(400).json({ error: 'refresh_token grant requires refreshToken.' });
      }
      form.set('grant_type', 'refresh_token');
      form.set('refresh_token', body.refreshToken);
    } else {
      return res.status(400).json({ error: `Unknown grantType: ${body.grantType}` });
    }

    try {
      const upstream = await fetchWithTimeout(body.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(upstream.status).json({
          error: `Token endpoint returned ${upstream.status}: ${text.slice(0, 500)}`,
        });
      }

      const data = (await upstream.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
      };

      if (!data.access_token) {
        return res.status(502).json({ error: 'Token endpoint returned no access_token.' });
      }

      // Normalize snake_case → camelCase for the client.
      return res.status(200).json({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return res.status(504).json({ error: 'Token endpoint did not respond within the timeout.' });
      }
      const message = err instanceof Error ? err.message : 'Token exchange failed.';
      console.error('[aviatrix/oauth-token] upstream error', err);
      return res.status(502).json({ error: message });
    }
  } catch (err) {
    console.error('[aviatrix/oauth-token] outer error', err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: `Proxy error: ${message}` });
    }
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
