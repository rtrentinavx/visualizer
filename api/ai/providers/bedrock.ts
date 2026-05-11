import type { VercelResponse } from '@vercel/node';
import { BedrockRuntimeClient, ConverseStreamCommand, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { ChatMessage } from '../types';

export async function proxyBedrock(
  res: VercelResponse,
  accessKeyId: string,
  secretAccessKey: string,
  region: string | undefined,
  modelId: string,
  messages: ChatMessage[],
  temperature: number,
  stream: boolean
) {
  const client = new BedrockRuntimeClient({
    region: region || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });

  const systemMsg = messages.find((m) => m.role === 'system');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    }));

  if (!stream) {
    const command = new ConverseCommand({
      modelId,
      messages: chatMessages,
      system: systemMsg ? [{ text: systemMsg.content }] : undefined,
      inferenceConfig: { temperature },
    });
    const response = await client.send(command);
    const text = response.output?.message?.content?.[0]?.text || '';
    return res.json({ content: text });
  }

  const command = new ConverseStreamCommand({
    modelId,
    messages: chatMessages,
    system: systemMsg ? [{ text: systemMsg.content }] : undefined,
    inferenceConfig: { temperature },
  });

  const response = await client.send(command);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for await (const chunk of response.stream) {
    if (chunk.contentBlockDelta) {
      const text = chunk.contentBlockDelta.delta?.text || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] }) }\n\n`);
      }
    }
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
