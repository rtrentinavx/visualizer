import type { AIProviderConfig } from './types';

export const providerConfigs: Record<string, AIProviderConfig> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    supportsCors: false,
    requiresProxy: true,
    defaultBaseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    defaultTemperature: 0.2,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    supportsCors: false,
    requiresProxy: true,
    defaultBaseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-3-5-sonnet-20241022',
    defaultTemperature: 0.2,
  },
  google: {
    id: 'google',
    name: 'Google (Gemini)',
    supportsCors: true,
    requiresProxy: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
    defaultModel: 'gemini-1.5-flash',
    defaultTemperature: 0.2,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    supportsCors: true,
    requiresProxy: false,
    defaultBaseUrl: 'http://localhost:11434',
    models: ['llama3.2', 'llama3.1', 'mistral', 'codellama', 'qwen2.5'],
    defaultModel: 'llama3.2',
    defaultTemperature: 0.2,
  },
  custom: {
    id: 'custom',
    name: 'Custom Endpoint',
    supportsCors: true,
    requiresProxy: false,
    defaultBaseUrl: '',
    models: [],
    defaultModel: '',
    defaultTemperature: 0.2,
  },
};

export function getProviderConfig(id: string): AIProviderConfig | undefined {
  return providerConfigs[id];
}
