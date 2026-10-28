type Loader<T> = () => Promise<T>;

/** Memoize a dynamic import so speculative loading and first render share one request. */
export function memoizeImport<T>(loader: Loader<T>): Loader<T> {
  let pending: Promise<T> | undefined;

  return () => {
    if (!pending) {
      pending = loader().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }

    return pending;
  };
}

/** Warm chunks after the current frame without competing with constrained connections. */
export function warmImportsWhenIdle(loaders: Loader<unknown>[]) {
  if (typeof window === 'undefined') return;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  if (
    connection?.saveData ||
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g' ||
    connection?.effectiveType === '3g'
  ) {
    return;
  }

  const warm = () => {
    if (document.visibilityState === 'hidden') return;
    for (const load of loaders) void load().catch(() => undefined);
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 2500 });
  } else {
    globalThis.setTimeout(warm, 500);
  }
}
