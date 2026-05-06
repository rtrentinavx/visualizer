import type { AIProfile, AIMessage, AIResponseChunk } from './types';

/**
 * Stream a chat completion from the AI provider.
 * Uses the Vercel edge proxy for all providers (handles provider-specific formatting).
 */
export async function* streamChat(
  profile: AIProfile,
  messages: AIMessage[],
  signal?: AbortSignal
): AsyncGenerator<AIResponseChunk, void, unknown> {
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

    // Final buffer flush
    if (buffer.trim()) {
      const chunk = parseSSELine(buffer.trim());
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat completion. Returns full response as string.
 */
export async function chatCompletion(
  profile: AIProfile,
  messages: AIMessage[],
  signal?: AbortSignal
): Promise<string> {
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
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI request failed: ${error}`);
  }

  const data = await response.json();
  return data.content || '';
}

function parseSSELine(line: string): AIResponseChunk | null {
  if (!line || line.startsWith(':')) return null;

  // SSE format: data: {...}
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

  // Plain JSON line (Ollama, some proxies)
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
