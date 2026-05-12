const CONSENT_KEY = 'dcf-ai-data-egress-consent';

/**
 * Tracks whether the user has explicitly acknowledged that topology data
 * (SmartGroup names, FQDN patterns, criteria values, IP CIDRs) will be sent
 * to the active AI provider when they invoke any AI feature.
 *
 * Stored separately from `AISettings.consentGiven` (which only covers local
 * API-key storage) so existing users get prompted to re-acknowledge the
 * broader data-egress concern.
 */
export function hasAIDataConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function grantAIDataConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'true');
  } catch { /* ignore */ }
}

export function revokeAIDataConsent(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch { /* ignore */ }
}
