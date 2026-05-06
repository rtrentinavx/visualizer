export type AIProvider = 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';

export interface AIProfile {
  id: string;
  name: string;
  provider: AIProvider;
  model: string;
  apiKey: string;
  apiBaseUrl?: string;
  temperature: number;
}

export interface AISettings {
  activeProfileId: string | null;
  profiles: AIProfile[];
  consentGiven: boolean;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequest {
  messages: AIMessage[];
  temperature: number;
  stream: boolean;
}

export interface AIResponseChunk {
  content: string;
  done: boolean;
}

export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  supportsCors: boolean;
  requiresProxy: boolean;
  defaultBaseUrl: string;
  models: string[];
  defaultModel: string;
  defaultTemperature: number;
}
