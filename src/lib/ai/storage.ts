import { encryptTopology, decryptTopology } from '../cryptoStorage';
import type { AISettings } from './types';

const AI_STORAGE_KEY = 'dcf-ai-settings-v1';

export async function saveAISettings(settings: AISettings): Promise<void> {
  const encrypted = await encryptTopology(settings);
  localStorage.setItem(AI_STORAGE_KEY, encrypted);
}

export async function loadAISettings(): Promise<AISettings | null> {
  try {
    const stored = localStorage.getItem(AI_STORAGE_KEY);
    if (!stored) return null;

    // Try encrypted format first
    const decrypted = await decryptTopology<AISettings>();
    if (decrypted) return decrypted;

    // Fallback: plain JSON (migration from older versions)
    const plain = localStorage.getItem(AI_STORAGE_KEY);
    if (plain && plain.startsWith('{')) {
      const parsed = JSON.parse(plain) as AISettings;
      // Re-save as encrypted
      await saveAISettings(parsed);
      return parsed;
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
