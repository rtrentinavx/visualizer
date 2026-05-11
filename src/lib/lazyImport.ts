import { lazy as reactLazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_FLAG = 'dcf-stale-chunk-reloaded';

/**
 * Vite splits each lazy module into a content-hashed file. When we deploy a new
 * version, the hashed filenames change. A user with an open tab from the
 * previous deploy still has the OLD `index.js`, which references the OLD chunk
 * hashes — so opening a lazy panel triggers `Failed to fetch dynamically
 * imported module` on the now-deleted file.
 *
 * lazyImport wraps `React.lazy` so that, on first stale-chunk failure per
 * session, we set a sessionStorage flag and reload the page. The reload pulls
 * the fresh `index.html` (and its updated chunk references) and the user
 * continues. The flag prevents an infinite reload loop in the rare case the
 * error persists after refresh — then we let the error propagate to Sentry's
 * ErrorBoundary like any other render failure.
 */
// Constraint matches React's own `lazy<T extends ComponentType<any>>` so that
// the caller's specific prop types are preserved end-to-end.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyImport<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(() =>
    factory().catch((err: unknown) => {
      if (isStaleChunkError(err)) {
        try {
          if (!sessionStorage.getItem(RELOAD_FLAG)) {
            sessionStorage.setItem(RELOAD_FLAG, '1');
            window.location.reload();
            // Resolve never; the reload tears down this page anyway.
            return new Promise<{ default: T }>(() => {});
          }
        } catch { /* sessionStorage may be unavailable — fall through */ }
      }
      throw err;
    }),
  );
}

function isStaleChunkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Cover Vite (`Failed to fetch dynamically imported module`), Webpack
  // (`ChunkLoadError`, `Loading chunk N failed`), and the generic
  // `Importing a module script failed` that some browsers emit.
  return /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError|Importing a module script failed/i.test(err.message);
}
