import type { AIProfile, AIMessage, AIResponseChunk } from './types';
import { scanInput, filterOutput } from './safety';

export interface ModelInfo {
  id: string;
  name?: string;
}

/**
 * Fetch the list of available models for a given AI profile. Local providers
 * (Ollama, LMStudio) are called directly from the browser because the serverless
 * proxy can't reach the user's localhost. Everything else goes through /api/ai/models.
 */
export async function fetchModels(profile: AIProfile): Promise<ModelInfo[]> {
  if (profile.provider === 'ollama') {
    const url = (profile.apiBaseUrl || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags';
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Ollama: ${r.status} ${r.statusText}`);
    const data = await r.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => ({ id: m.name }));
  }
  if (profile.provider === 'lmstudio') {
    const url = (profile.apiBaseUrl || 'http://localhost:1234').replace(/\/+$/, '') + '/v1/models';
    const headers: Record<string, string> = {};
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`LM Studio: ${r.status} ${r.statusText}`);
    const data = await r.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => ({ id: m.id }));
  }
  const r = await fetch('/api/ai/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: profile.provider,
      apiKey: profile.apiKey,
      apiBaseUrl: profile.apiBaseUrl,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text).error ?? text; } catch { /* keep raw text */ }
    throw new Error(detail || `Model list failed: ${r.status}`);
  }
  const data = await r.json() as { models: ModelInfo[] };
  return data.models;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AICompletionResult {
  content: string;
  usage?: AIUsage;
}

/**
 * Stream a chat completion from the AI provider.
 * Uses the Vercel edge proxy for all providers.
 *
 * New: includes promptVersion for auditability and input safety scanning.
 */
export async function* streamChat(
  profile: AIProfile,
  messages: AIMessage[],
  promptVersion?: string,
  signal?: AbortSignal
): AsyncGenerator<AIResponseChunk, void, unknown> {
  // Safety: scan the last user message for injection patterns
  const lastUserMsg = messages.findLast((m) => m.role === 'user');
  if (lastUserMsg) {
    const scan = scanInput(lastUserMsg.content);
    if (scan.status === 'blocked') {
      throw new Error(`Safety check failed: ${scan.reason}`);
    }
  }

  const response = await fetch('/api/ai/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: profile.provider,
      apiKey: profile.apiKey,
      apiBaseUrl: profile.apiBaseUrl,
      model: profile.model,
      messages,
      temperature: profile.temperature,
      stream: true,
      promptVersion,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI request failed: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const chunk = parseSSELine(line.trim());
        if (chunk) yield chunk;
      }
    }

    if (buffer.trim()) {
      const chunk = parseSSELine(buffer.trim());
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat completion. Returns full response + token usage.
 *
 * New: returns usage data for cost/optimization tracking.
 */
export async function chatCompletion(
  profile: AIProfile,
  messages: AIMessage[],
  promptVersion?: string,
  signal?: AbortSignal
): Promise<AICompletionResult> {
  const lastUserMsg = messages.findLast((m) => m.role === 'user');
  if (lastUserMsg) {
    const scan = scanInput(lastUserMsg.content);
    if (scan.status === 'blocked') {
      throw new Error(`Safety check failed: ${scan.reason}`);
    }
  }

  const response = await fetch('/api/ai/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: profile.provider,
      apiKey: profile.apiKey,
      apiBaseUrl: profile.apiBaseUrl,
      model: profile.model,
      messages,
      temperature: profile.temperature,
      stream: false,
      promptVersion,
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI request failed: ${error}`);
  }

  const data = await response.json();
  const content = data.content || '';

  // Output content filtering for non-streaming responses
  const filter = filterOutput(content);
  if (filter.status === 'blocked') {
    throw new Error(`Output blocked: ${filter.reason}`);
  }

  return {
    content,
    usage: data.usage,
  };
}

/**
 * Post-process a fully-assembled streaming AI response.
 * Combines output content filtering with caller-provided schema validation.
 * Call this after streaming completes and you have the full response text.
 */
export function postProcessAIOutput(fullText: string): { ok: true } | { ok: false; reason: string } {
  const filter = filterOutput(fullText);
  if (filter.status === 'blocked') {
    return { ok: false, reason: `Output blocked: ${filter.reason}` };
  }
  return { ok: true };
}

function parseSSELine(line: string): AIResponseChunk | null {
  if (!line || line.startsWith(':')) return null;

  if (line.startsWith('data: ')) {
    const data = line.slice(6);
    if (data === '[DONE]') return { content: '', done: true };

    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.[0]?.delta?.content
        || parsed.choices?.[0]?.text
        || parsed.delta?.text
        || parsed.content
        || '';
      return { content, done: false };
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(line);
    const content = parsed.message?.content
      || parsed.response
      || parsed.choices?.[0]?.message?.content
      || '';
    return { content, done: parsed.done === true };
  } catch {
    return null;
  }
}
