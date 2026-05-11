import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types';

export async function proxyOllama(
  res: VercelResponse,
  apiBaseUrl: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  const base = apiBaseUrl || 'http://localhost:11434';
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream, options: { temperature } }),
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).send(error);
  }

  // Ollama returns NDJSON. Convert to SSE.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = response.body!.getReader();
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
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const text = parsed.message?.content || '';
          if (text) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
          }
          if (parsed.done) {
            res.write('data: [DONE]\n\n');
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  res.end();
}
