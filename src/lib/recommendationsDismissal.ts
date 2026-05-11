const DISMISS_KEY = 'dcf-recommendations-dismissed';

export function isRecommendationsDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissRecommendations() {
  try {
    localStorage.setItem(DISMISS_KEY, 'true');
  } catch { /* ignore */ }
}

export function clearRecommendationsDismissal() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch { /* ignore */ }
}
