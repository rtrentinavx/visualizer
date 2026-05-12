import type { VercelRequest, VercelResponse } from '@vercel/node';

// Same per-invocation timeout posture as the other AI endpoints — see proxy.ts.
export const config = {
  maxDuration: 30,
};

interface ModerateRequest {
  apiKey: string;
  input: string;
}

interface ModerateResponse {
  flagged: boolean;
  /** Provider-reported category names with above-threshold scores. */
  categories: string[];
  /** OpenAI's category_scores map verbatim (small float dict). */
  scores?: Record<string, number>;
}

/**
 * Free-tier content moderation via OpenAI's /v1/moderations endpoint. Called
 * from the client before the main AI request when the active profile is
 * OpenAI. Other providers don't ship an equivalent free moderation endpoint;
 * the client skips this call for them (no false sense of coverage).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { apiKey, input } = (req.body || {}) as ModerateRequest;
  if (!apiKey) return res.status(400).json({ error: 'Missing apiKey' });
  if (!input || typeof input !== 'string') return res.status(400).json({ error: 'Missing input' });
  // Cap to avoid sending huge prompts through the moderation API — it accepts
  // arrays too but we're just doing a single user-text check here.
  if (input.length > 32_000) return res.status(413).json({ error: 'Input too large for moderation (max 32 KB)' });

  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input, model: 'omni-moderation-latest' }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `Moderation failed: ${text}` });
    }

    const data = await r.json() as {
      results?: Array<{
        flagged: boolean;
        categories?: Record<string, boolean>;
        category_scores?: Record<string, number>;
      }>;
    };
    const first = data.results?.[0];
    if (!first) {
      return res.status(502).json({ error: 'Moderation returned no result' });
    }

    const flaggedCategories = Object.entries(first.categories ?? {})
      .filter(([, on]) => on)
      .map(([name]) => name);

    const response: ModerateResponse = {
      flagged: first.flagged,
      categories: flaggedCategories,
      scores: first.category_scores,
    };
    return res.status(200).json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Moderation failed';
    return res.status(502).json({ error: message });
  }
}
