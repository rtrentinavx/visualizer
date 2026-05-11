import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types';

export async function proxyLMStudio(
  res: VercelResponse,
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  const base = apiBaseUrl || 'http://localhost:1234';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature, stream }),
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).send(error);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = response.body!.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
  }

  res.end();
}
