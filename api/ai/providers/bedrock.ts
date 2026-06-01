import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types.js';
import { fetchWithTimeout } from '../_timeout.js';

/**
 * Bedrock authenticates with a long-term API key (Bearer token).
 * Region is passed via profile.apiBaseUrl (defaults to us-east-1).
 *
 * Streaming: we use /converse-stream which returns AWS event-stream binary
 * frames. We decode them by scanning for the JSON payload inside each frame
 * rather than implementing the full binary vnd.amazon.eventstream protocol.
 * Each frame has a variable-length prelude followed by JSON that contains
 * either { "contentBlockDelta": { "delta": { "text": "..." } } } for content
 * or { "messageStop": { ... } } for end-of-stream.
 *
 * For non-streaming callers we fall back to the synchronous /converse endpoint.
 */
export async function proxyBedrock(
  res: VercelResponse,
  apiKey: string,
  region: string | undefined,
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean,
) {
  const r = (region || 'us-east-1').trim();

  const systemMsg = messages.find((m) => m.role === 'system');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    }));

  const body = {
    messages: chatMessages,
    system: systemMsg ? [{ text: systemMsg.content }] : undefined,
    inferenceConfig: { temperature },
  };

  if (!stream) {
    // Non-streaming: synchronous Converse
    const url = `https://bedrock-runtime.${r}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return res.status(response.status).send(await response.text());
    const data = await response.json() as {
      output?: { message?: { content?: Array<{ text?: string }> } };
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };
    const text = data.output?.message?.content?.[0]?.text || '';
    return res.json({ content: text, usage: data.usage ? {
      promptTokens: data.usage.inputTokens,
      completionTokens: data.usage.outputTokens,
      totalTokens: data.usage.totalTokens,
    } : undefined });
  }

  // Streaming: use converse-stream endpoint
  const url = `https://bedrock-runtime.${r}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse-stream`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).send(error);
  }

  // Set up SSE response headers immediately so the client can start reading
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = response.body?.getReader();
  if (!reader) {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // The AWS event stream format wraps each event in binary frames.
  // Each frame: 4-byte total length, 4-byte header length, 4-byte prelude CRC,
  // then headers, then a JSON payload, then a 4-byte message CRC.
  // Rather than implementing the full binary protocol, we scan the raw bytes
  // for the JSON payload by looking for the UTF-8 sequence of known event keys.
  // This is resilient to frame boundaries since we accumulate a rolling buffer.
  const decoder = new TextDecoder();
  let rawBuffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode bytes to string — binary frame headers will be garbage but
      // the JSON payloads are valid UTF-8 and survive this decode.
      rawBuffer += decoder.decode(value, { stream: true });

      // Extract all JSON objects from the buffer using brace-depth tracking
      let start = -1;
      let depth = 0;
      for (let i = 0; i < rawBuffer.length; i++) {
        const ch = rawBuffer[i];
        if (ch === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            const candidate = rawBuffer.slice(start, i + 1);
            try {
              const parsed = JSON.parse(candidate) as Record<string, unknown>;
              const text = extractBedrockText(parsed);
              if (text) {
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
              }
              if (isBedrockDone(parsed)) {
                rawBuffer = rawBuffer.slice(i + 1);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
            } catch {
              // Not valid JSON — skip (binary frame header garbage)
            }
            start = -1;
          }
        }
      }
      // Keep only the unparsed tail
      if (start !== -1) {
        rawBuffer = rawBuffer.slice(start);
      } else {
        rawBuffer = '';
      }
    }
  } finally {
    reader.releaseLock();
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function extractBedrockText(obj: Record<string, unknown>): string {
  // converse-stream delta event
  const delta = (obj.contentBlockDelta as Record<string, unknown> | undefined)?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.text === 'string') return delta.text;
  return '';
}

function isBedrockDone(obj: Record<string, unknown>): boolean {
  return 'messageStop' in obj || 'stopReason' in obj;
}
