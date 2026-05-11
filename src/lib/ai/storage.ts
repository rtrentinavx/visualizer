import { encryptTopology, decryptTopology } from '../cryptoStorage';
import type { AISettings } from './types';

const AI_STORAGE_KEY = 'dcf-ai-settings-v1';

function isValidAISettings(value: unknown): value is AISettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.profiles) &&
    (typeof v.activeProfileId === 'string' || v.activeProfileId === null) &&
    typeof v.consentGiven === 'boolean'
  );
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  const encrypted = await encryptTopology(settings);
  localStorage.setItem(AI_STORAGE_KEY, encrypted);
}

export async function loadAISettings(): Promise<AISettings | null> {
  try {
    const stored = localStorage.getItem(AI_STORAGE_KEY);
    if (!stored) return null;

    // Decrypt the AI-settings bucket. Until this fix, decryptTopology was
    // hardcoded to the topology key, so this call silently returned the user's
    // *topology* cast as AISettings — App.tsx then crashed on `profiles.find`.
    const decrypted = await decryptTopology<unknown>(AI_STORAGE_KEY);
    if (isValidAISettings(decrypted)) return decrypted;

    // Fallback: plain JSON (migration from older versions before encryption).
    if (stored.startsWith('{')) {
      const parsed = JSON.parse(stored) as unknown;
      if (isValidAISettings(parsed)) {
        await saveAISettings(parsed);
        return parsed;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function clearAISettings(): void {
  localStorage.removeItem(AI_STORAGE_KEY);
}

export function getDefaultAISettings(): AISettings {
  return {
    activeProfileId: null,
    profiles: [],
    consentGiven: false,
  };
}
