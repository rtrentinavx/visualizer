import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types';
import { fetchWithTimeout } from '../_timeout';

export async function proxyAnthropic(
  res: VercelResponse,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: messages.filter((m) => m.role !== 'system'),
      system: messages.find((m) => m.role === 'system')?.content,
      temperature,
      max_tokens: 4096,
      stream,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).send(error);
  }

  if (!stream) {
    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    const usage = data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined;
    return res.json({ content, usage });
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
