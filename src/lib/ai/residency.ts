import type { AIProvider } from './types';

export interface ProviderResidency {
  /** Short label fits in a badge. */
  short: string;
  /** Longer one-line summary for tooltips / consent modal. */
  long: string;
  /** Local providers don't egress data — used for distinct styling. */
  local: boolean;
}

/**
 * Best-effort residency information per provider. Reflects each provider's
 * documented defaults as of the policy revision date in AI_USE_POLICY.md;
 * specific accounts and enterprise plans may differ.
 */
export const PROVIDER_RESIDENCY: Record<AIProvider, ProviderResidency> = {
  openai: {
    short: 'US',
    long: 'OpenAI processes API data in the United States. Enterprise plans offer zero-retention.',
    local: false,
  },
  anthropic: {
    short: 'US',
    long: 'Anthropic processes data in the US by default. EU residency on Enterprise plans.',
    local: false,
  },
  google: {
    short: 'US',
    long: 'Google Gemini API processes data primarily in the US; region varies by GCP project.',
    local: false,
  },
  bedrock: {
    short: 'AWS Region',
    long: 'Data is processed in the AWS region configured in the profile (e.g. us-east-1).',
    local: false,
  },
  ollama: {
    short: 'Local',
    long: 'Calls go from the browser to your local Ollama; no data leaves your network.',
    local: true,
  },
  lmstudio: {
    short: 'Local',
    long: 'Calls go from the browser to your local LM Studio; no data leaves your network.',
    local: true,
  },
  custom: {
    short: 'Unknown',
    long: 'Residency depends on the custom endpoint URL configured on the profile.',
    local: false,
  },
};

export function getResidency(provider: string): ProviderResidency {
  return PROVIDER_RESIDENCY[provider as AIProvider] ?? PROVIDER_RESIDENCY.custom;
}
