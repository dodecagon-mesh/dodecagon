// keep these in sync with apps/client/public/media-cache-worker.js: the worker
// writes the entries and this module reads and clears them
export const MEDIA_CACHE_NAME = 'dodecagon-media-v1';

export const MEDIA_CACHE_PREFIX = 'dodecagon-media-';

export const isMediaCacheSupported = () => typeof caches !== 'undefined';

export const registerMediaCacheWorker = () => {
  if (typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!isMediaCacheSupported()) return;

  const { serviceWorker } = navigator;

  const registration = serviceWorker.register('/media-cache-worker.js', {
    type: 'module'
  });

  // the http cache still serves media without the worker, so a refused
  // registration is not worth surfacing or retrying
  registration.catch(() => {});
};

export const getMediaCacheStats = async (): Promise<{
  entries: number;
  bytes: number;
}> => {
  if (!isMediaCacheSupported()) {
    return { entries: 0, bytes: 0 };
  }

  try {
    const cache = await caches.open(MEDIA_CACHE_NAME);
    const keys = await cache.keys();

    let bytes = 0;

    for (const key of keys) {
      const response = await cache.match(key);

      if (!response) continue;

      const blob = await response.blob();

      bytes += blob.size;
    }

    return { entries: keys.length, bytes };
  } catch {
    // a storage the browser denies reports nothing rather than failing the tab
    return { entries: 0, bytes: 0 };
  }
};

export const clearMediaCache = async (): Promise<void> => {
  if (!isMediaCacheSupported()) return;

  const names = await caches.keys();
  const mediaCaches = names.filter((name) =>
    name.startsWith(MEDIA_CACHE_PREFIX)
  );

  await Promise.all(mediaCaches.map((name) => caches.delete(name)));
};
