// keep the bucket name in sync with apps/client/src/helpers/media-cache.ts: the
// tab reads the entries this worker writes
export const MEDIA_CACHE_NAME = 'dodecagon-media-v1';

// the token and its expiry change on every render, the bytes behind them do not,
// so they cannot be part of the key or nothing would ever hit
export const getMediaCacheKey = (url) => {
  const parsedUrl = new URL(url);

  parsedUrl.searchParams.delete('accessToken');
  parsedUrl.searchParams.delete('expires');

  return parsedUrl.toString();
};

export const isMediaRequest = (request, origin) => {
  if (request.method !== 'GET') {
    return false;
  }

  // a range request wants a slice of the file, not the whole answer a cache holds
  if (request.headers.has('range')) {
    return false;
  }

  const url = new URL(request.url);

  if (url.origin !== origin) {
    return false;
  }

  if (!url.pathname.startsWith('/public/')) {
    return false;
  }

  // videos read their bytes through a media element and range requests, only
  // images take the whole response and can live in a cache
  if (request.destination !== 'image') {
    return false;
  }

  return url.searchParams.has('v');
};

export const respondFromMediaCache = async (request) => {
  const cacheKey = getMediaCacheKey(request.url);

  let cache = null;

  try {
    cache = await caches.open(MEDIA_CACHE_NAME);
  } catch {
    // a browser that refuses the storage, a private window for one, still has
    // the network answer for the image
  }

  if (cache) {
    try {
      const cachedResponse = await cache.match(cacheKey);

      if (cachedResponse) {
        return cachedResponse;
      }
    } catch {
      // an unreadable entry is a miss, the network still has the file
    }
  }

  const response = await fetch(request, { cache: 'no-store' });

  // only a successful same origin answer holds the bytes of the file, an opaque
  // answer cannot be stored or read back
  if (cache && response.ok && response.type === 'basic') {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      // a full or refused storage does not fail the image
    }
  }

  return response;
};

if (
  typeof self !== 'undefined' &&
  typeof self.addEventListener === 'function'
) {
  self.addEventListener('fetch', (event) => {
    const { request } = event;

    if (!isMediaRequest(request, self.location.origin)) {
      return;
    }

    event.respondWith(respondFromMediaCache(request));
  });
}
