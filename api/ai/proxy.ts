import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import type { ChatMessage } from './types';
import { proxyOpenAI } from './providers/openai';
import { proxyAnthropic } from './providers/anthropic';
import { proxyGoogle } from './providers/google';
import { proxyOllama } from './providers/ollama';
import { proxyLMStudio } from './providers/lmstudio';
import { proxyBedrock } from './providers/bedrock';
import { proxyCustom } from './providers/custom';
import { isTimeoutError, PROVIDER_FETCH_TIMEOUT_MS } from './_timeout';

// Initialize Redis lazily and defensively. If UPSTASH_REDIS_REST_URL or
// UPSTASH_REDIS_REST_TOKEN are missing/malformed, `Redis.fromEnv()` THROWS at
// module load — which crashes the entire function before any handler code
// runs and surfaces as FUNCTION_INVOCATION_FAILED on every request. Defer the
// init into a function so a missing env config just disables rate limiting
// instead of taking the whole proxy down.
let redisInstance: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redisInstance !== undefined) return redisInstance;
  try {
    redisInstance = Redis.fromEnv();
  } catch (err) {
    console.warn('[ai/proxy] Redis.fromEnv failed; rate limiting disabled.', err);
    redisInstance = null;
  }
  return redisInstance;
}

const RATE_LIMIT = 30; // requests per minute per IP

// Extend the function's per-invocation timeout. Default on Vercel Hobby is 10s
// (max 25s); Pro defaults to 60s (max 300s). Non-streaming AI calls — especially
// the Evaluator's AI Fix that waits for a full JSON response — regularly exceed
// 10s under load. Setting maxDuration to 60s gives slow models headroom; on the
// Hobby plan this gets clamped to 25s, still better than the default 10s. When
// the upstream provider itself is the slow one, the client gets a clear 504 or
// the structured error from the catch block instead of FUNCTION_INVOCATION_FAILED.
export const config = {
  maxDuration: 60,
};

interface ProxyRequest {
  provider: string;
  apiKey: string;
  apiBaseUrl?: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  stream: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // OUTER try/catch covers EVERY path including body parsing, validation, and
  // dispatch — any uncaught error becomes a 500 JSON response instead of the
  // bare FUNCTION_INVOCATION_FAILED platform error, and is logged with stack
  // detail so it shows up in Vercel function logs.
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Body size limit: reject requests larger than 1MB to prevent abuse
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 1024 * 1024) {
      return res.status(413).json({ error: 'Request body too large. Max 1MB.' });
    }

    // Guard against the destructuring throw — req.body can be undefined if the
    // payload wasn't JSON-decodable for whatever reason.
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is missing or not JSON.' });
    }
    const { provider, apiKey, apiBaseUrl, model, messages, temperature, stream } = req.body as ProxyRequest;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing or invalid field: messages (must be an array).' });
    }

    // Validate message content length to prevent token overflow attacks
    const totalContentLength = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    if (totalContentLength > 50000) {
      return res.status(413).json({ error: 'Total message content exceeds 50KB limit.' });
    }

    if (!provider || !model) {
      return res.status(400).json({ error: 'Missing required fields: provider, model' });
    }

    // Rate limiting (best-effort — disabled if Redis isn't configured)
    const redis = getRedis();
    if (redis) {
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
      const windowKey = `dcf-ai-rate:${clientIp}:${Math.floor(Date.now() / 60000)}`;
      try {
        const current = await redis.incr(windowKey);
        if (current === 1) {
          await redis.expire(windowKey, 60);
        }
        if (current > RATE_LIMIT) {
          return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
        }
      } catch {
        // If Redis is transiently down, allow the request through rather than break AI features
      }
    }

    // SECURITY: API keys pass through this proxy but are NEVER logged, stored,
    // or cached server-side. They are forwarded directly to the AI provider.
    const needsKey = provider !== 'ollama' && provider !== 'lmstudio';
    if (needsKey && !apiKey) {
      return res.status(400).json({ error: 'Missing required field: apiKey' });
    }

    try {
      switch (provider) {
        case 'openai':
          return await proxyOpenAI(res, apiKey, model, messages, temperature, stream);
        case 'anthropic':
          return await proxyAnthropic(res, apiKey, model, messages, temperature, stream);
        case 'google':
          return await proxyGoogle(res, apiKey, model, messages, temperature);
        case 'ollama':
          return await proxyOllama(res, apiBaseUrl as string, model, messages, temperature, stream);
        case 'lmstudio':
          return await proxyLMStudio(res, apiBaseUrl as string, apiKey, model, messages, temperature, stream);
        case 'bedrock':
          return await proxyBedrock(res, apiKey, apiBaseUrl, model, messages, temperature, stream);
        case 'custom':
          return await proxyCustom(res, apiBaseUrl as string, apiKey, model, messages, temperature, stream);
        default:
          return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
    } catch (err) {
      // Translate an aborted upstream fetch (fetchWithTimeout fired its
      // watchdog) into a clean 504. The client's formatProxyError surfaces
      // 504 as "Try a faster model or simpler prompt."
      if (isTimeoutError(err)) {
        if (!res.headersSent) {
          return res.status(504).json({
            error: `Provider "${provider}" did not respond within ${Math.round(PROVIDER_FETCH_TIMEOUT_MS / 1000)}s. Try a faster model (e.g. gpt-4o-mini, claude-haiku, gemini-flash) or shorten the prompt.`,
          });
        }
        // Headers already sent on a streaming response — terminate cleanly.
        try { res.end(); } catch { /* connection already closed */ }
        return;
      }
      console.error('[ai/proxy] provider call failed', { provider, error: err });
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ error: message });
      }
      try { res.end(); } catch { /* already closed */ }
      return;
    }
  } catch (err) {
    // Anything that escaped the inner blocks. Log + best-effort 500.
    console.error('[ai/proxy] outer handler error', err);
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ error: `Proxy error: ${message}` });
    }
    try { res.end(); } catch { /* already closed */ }
  }
}
