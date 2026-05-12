/**
 * Shared per-request timeout for provider fetches. Vercel kills the function
 * at maxDuration (60s on Pro, clamped to 25s on Hobby) and emits
 * `FUNCTION_INVOCATION_FAILED` — which surfaces to the user as a cryptic
 * "AI proxy timed out or crashed". This helper aborts the upstream fetch a
 * few seconds before that deadline so the dispatch in proxy.ts can return a
 * clean 504 with a helpful message instead.
 *
 * 22s sits safely under the Hobby 25s ceiling and well below Pro's 60s.
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 22_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  // Some runtimes throw a DOMException with a different name shape; check message too.
  return /abort|timed?\s*out/i.test(err.message);
}
