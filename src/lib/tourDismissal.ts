const TOUR_COMPLETED_KEY = 'dcf-tour-completed';
const TOUR_AUTOSHOWN_KEY = 'dcf-tour-auto-shown';

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markTourCompleted(): void {
  try {
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
  } catch { /* ignore */ }
}

export function wasTourAutoShown(): boolean {
  try {
    return localStorage.getItem(TOUR_AUTOSHOWN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markTourAutoShown(): void {
  try {
    localStorage.setItem(TOUR_AUTOSHOWN_KEY, 'true');
  } catch { /* ignore */ }
}

export function clearTourFlags(): void {
  try {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
    localStorage.removeItem(TOUR_AUTOSHOWN_KEY);
  } catch { /* ignore */ }
}
