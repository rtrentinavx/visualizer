import type { VercelResponse } from '@vercel/node';
import type { ChatMessage } from '../types';
import { fetchWithTimeout } from '../_timeout';

/**
 * Bedrock now authenticates with a long-term API key (Bearer token) instead of
 * IAM access-key + secret SigV4 signing. The endpoint is region-scoped:
 *   POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
 *
 * Region is passed via the profile's apiBaseUrl field (reused as a region
 * slot for Bedrock; defaults to us-east-1 if omitted).
 *
 * Streaming note: Bedrock's native streaming uses AWS event streams (binary
 * application/vnd.amazon.eventstream frames), which would need a dedicated
 * parser. For v1 we issue a non-streaming Converse call and replay it as a
 * single SSE chunk so the client's parser keeps working. Full response still
 * arrives correctly; just not word-by-word.
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
  const url = `https://bedrock-runtime.${r}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

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

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(response.status).send(error);
  }

  const data = await response.json() as {
    output?: { message?: { content?: Array<{ text?: string }> } };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
  const text = data.output?.message?.content?.[0]?.text || '';
  const usage = data.usage ? {
    promptTokens: data.usage.inputTokens,
    completionTokens: data.usage.outputTokens,
    totalTokens: data.usage.totalTokens,
  } : undefined;

  if (!stream) {
    return res.json({ content: text, usage });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
