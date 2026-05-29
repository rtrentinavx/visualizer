import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithTimeout, isTimeoutError } from './_timeout.js';

// Some providers' model-list endpoints are slow; give the function room to
// complete instead of hitting the default 10s timeout and returning
// FUNCTION_INVOCATION_FAILED. See proxy.ts for the same pattern + rationale.
export const config = {
  maxDuration: 30,
};

interface ModelsRequest {
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

interface ModelInfo {
  id: string;
  name?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { provider, apiKey, apiBaseUrl } = (req.body || {}) as ModelsRequest;
  if (!provider) {
    return res.status(400).json({ error: 'Missing required field: provider' });
  }

  try {
    let models: ModelInfo[] = [];
    switch (provider) {
      case 'openai':
        models = await listOpenAI(requireKey(apiKey, 'openai'));
        break;
      case 'anthropic':
        models = await listAnthropic(requireKey(apiKey, 'anthropic'));
        break;
      case 'google':
        models = await listGoogle(requireKey(apiKey, 'google'));
        break;
      case 'custom':
        if (!apiBaseUrl) return res.status(400).json({ error: 'Base URL required for custom provider' });
        models = await listOpenAICompatible(apiBaseUrl, apiKey);
        break;
      case 'bedrock':
        models = await listBedrock(requireKey(apiKey, 'bedrock'), apiBaseUrl);
        break;
      case 'ollama':
      case 'lmstudio':
        return res.status(400).json({ error: `${provider} is local; the client should fetch directly.` });
      default:
        return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    return res.status(200).json({ models });
  } catch (err) {
    if (isTimeoutError(err)) {
      return res.status(504).json({ error: `Provider "${provider}" model list did not respond in time. Check the endpoint or retry.` });
    }
    const message = err instanceof Error ? err.message : 'Failed to list models';
    return res.status(502).json({ error: message });
  }
}

function requireKey(key: string | undefined, provider: string): string {
  if (!key) throw new Error(`Missing apiKey for ${provider}`);
  return key;
}

async function listOpenAI(apiKey: string): Promise<ModelInfo[]> {
  const r = await fetchWithTimeout('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) throw new Error(`OpenAI: ${r.status} ${r.statusText}`);
  const data = await r.json() as { data?: Array<{ id: string }> };
  // OpenAI returns embeddings, tts, whisper, dall-e alongside chat models. Filter
  // to chat-capable IDs: gpt-*, o1/o3/o4 series, chatgpt-*.
  return (data.data ?? [])
    .filter((m) => /^(gpt-|o\d|chatgpt)/i.test(m.id))
    .map((m) => ({ id: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function listAnthropic(apiKey: string): Promise<ModelInfo[]> {
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  if (!r.ok) throw new Error(`Anthropic: ${r.status} ${r.statusText}`);
  const data = await r.json() as { data?: Array<{ id: string; display_name?: string }> };
  return (data.data ?? []).map((m) => ({ id: m.id, name: m.display_name }));
}

async function listGoogle(apiKey: string): Promise<ModelInfo[]> {
  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {});
  if (!r.ok) throw new Error(`Google: ${r.status} ${r.statusText}`);
  const data = await r.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }));
}

async function listOpenAICompatible(baseUrl: string, apiKey?: string): Promise<ModelInfo[]> {
  const url = baseUrl.replace(/\/+$/, '') + '/v1/models';
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const r = await fetchWithTimeout(url, { headers });
  if (!r.ok) throw new Error(`Endpoint: ${r.status} ${r.statusText}`);
  const data = await r.json() as { data?: Array<{ id: string }>; models?: Array<{ id: string }> };
  return (data.data ?? data.models ?? []).map((m) => ({ id: m.id }));
}

function bedrockCurated(): ModelInfo[] {
  return [
    { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude 3.5 Sonnet v2' },
    { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', name: 'Claude 3.5 Haiku' },
    { id: 'anthropic.claude-3-opus-20240229-v1:0', name: 'Claude 3 Opus' },
    { id: 'amazon.nova-pro-v1:0', name: 'Nova Pro' },
    { id: 'amazon.nova-lite-v1:0', name: 'Nova Lite' },
    { id: 'meta.llama3-2-90b-instruct-v1:0', name: 'Llama 3.2 90B' },
    { id: 'meta.llama3-1-70b-instruct-v1:0', name: 'Llama 3.1 70B' },
  ];
}

async function listBedrock(apiKey: string, regionOrUrl?: string): Promise<ModelInfo[]> {
  // Accept bare region ("us-east-1"), full base URL, or default to us-east-1
  let region = 'us-east-1';
  if (regionOrUrl) {
    const m = regionOrUrl.match(/bedrock[.-]([a-z0-9-]+)\.amazonaws\.com/);
    if (m) {
      region = m[1];
    } else if (/^[a-z]{2}-[a-z]+-\d+$/.test(regionOrUrl)) {
      region = regionOrUrl;
    }
  }

  const base = `https://bedrock.${region}.amazonaws.com`;
  const headers = { Authorization: `Bearer ${apiKey}` };

  // Tolerate partial failures: a key may have InvokeModel but not ListFoundationModels
  const [fmResult, ipResult] = await Promise.allSettled([
    fetchBedrockFoundationModels(base, headers),
    fetchBedrockInferenceProfiles(base, headers),
  ]);

  const fmModels = fmResult.status === 'fulfilled' ? fmResult.value : [];
  const ipModels = ipResult.status === 'fulfilled' ? ipResult.value : [];

  if (fmModels.length === 0 && ipModels.length === 0) {
    return bedrockCurated();
  }

  // Inference profiles take priority (cross-region, expose newer models like Claude 4)
  const profileIds = new Set(ipModels.map((m) => m.id));
  const fmFiltered = fmModels.filter((m) => !profileIds.has(m.id));

  return [...ipModels, ...fmFiltered].sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchBedrockFoundationModels(base: string, headers: Record<string, string>): Promise<ModelInfo[]> {
  const url = `${base}/foundation-models?byOutputModality=TEXT&byInferenceType=ON_DEMAND`;
  const r = await fetchWithTimeout(url, { headers });
  if (!r.ok) throw new Error(`Bedrock foundation-models: ${r.status}`);
  const data = await r.json() as {
    modelSummaries?: Array<{
      modelId: string;
      modelName?: string;
      providerName?: string;
      inputModalities?: string[];
    }>;
  };
  return (data.modelSummaries ?? [])
    .filter((m) => {
      if (!(m.inputModalities ?? []).some((mod) => /text/i.test(mod))) return false;
      if (/embed/i.test(m.modelId)) return false;
      if (m.providerName?.toLowerCase().includes('stability')) return false;
      return true;
    })
    .map((m) => ({ id: m.modelId, name: m.modelName }));
}

async function fetchBedrockInferenceProfiles(base: string, headers: Record<string, string>): Promise<ModelInfo[]> {
  const results: ModelInfo[] = [];
  let nextToken: string | undefined;
  do {
    const qs = nextToken
      ? `typeEquals=SYSTEM_DEFINED&maxResults=100&nextToken=${encodeURIComponent(nextToken)}`
      : `typeEquals=SYSTEM_DEFINED&maxResults=100`;
    const r = await fetchWithTimeout(`${base}/inference-profiles?${qs}`, { headers });
    if (!r.ok) throw new Error(`Bedrock inference-profiles: ${r.status}`);
    const data = await r.json() as {
      inferenceProfileSummaries?: Array<{ inferenceProfileId: string; inferenceProfileName?: string }>;
      nextToken?: string;
    };
    for (const p of data.inferenceProfileSummaries ?? []) {
      results.push({ id: p.inferenceProfileId, name: p.inferenceProfileName });
    }
    nextToken = data.nextToken;
  } while (nextToken);
  return results;
}
