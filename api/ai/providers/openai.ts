import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types';

export async function proxyOpenAI(
  res: VercelResponse,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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

  // Non-streaming: extract content + usage for token tracking
  if (!stream) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const usage = data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
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
