/**
 * Shared per-request timeout for provider fetches. Vercel kills the function
 * at maxDuration (60s on Pro, clamped to 25s on Hobby) and emits
 * `FUNCTION_INVOCATION_FAILED` — which surfaces to the user as a cryptic
 * "AI proxy timed out or crashed". This helper aborts the upstream fetch a
 * few seconds before that deadline so the dispatch in proxy.ts can return a
 * clean 504 with a helpful message instead.
 *
 * 22s sits safely under the Hobby 25s ceiling and well below Pro's 60s.
 *
 * IMPORTANT: We use `AbortSignal.timeout()` rather than a manual
 * AbortController + setTimeout pair, because `fetch()` resolves as soon as
 * the response **headers** arrive — but body reads (`response.json()`,
 * `reader.read()`) that follow can still hang for 20+ seconds when a slow
 * model is generating a long completion. With AbortSignal.timeout, the
 * signal owns its own lifecycle and continues to abort body reads after the
 * fetch promise resolves, so the watchdog truly covers the whole call.
 *
 * (Non-streaming requests: the abort throws into the catch block in proxy.ts
 * which returns a clean 504. Streaming requests: once SSE headers are
 * committed, an abort kills the in-flight read but proxy.ts can no longer
 * change the response code — the stream just terminates. That's a different
 * failure mode than the HTML-500 this helper fixes.)
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 22_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortSignal.timeout() rejects with DOMException name === 'TimeoutError'.
  // Manual AbortController.abort() rejects with name === 'AbortError'.
  // Some runtimes vary, so check both names and fall back to message regex.
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  return /abort|timed?\s*out/i.test(err.message);
}
