import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types.js';
import { fetchWithTimeout } from '../_timeout.js';

export async function proxyCustom(
  res: VercelResponse,
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  if (!apiBaseUrl) {
    return res.status(400).json({ error: 'Custom provider requires apiBaseUrl' });
  }

  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
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
