// Runs the media cache worker against fake self/caches/fetch globals and prints
// the scenarios as JSON. The worker lives in public/ so it ships as a module,
// which the type checker does not resolve from src.
type TFakeRequest = {
  method: string;
  url: string;
  headers: Headers;
  destination: string;
};

type TFakeResponse = {
  ok: boolean;
  type: string;
  body: string;
  clone: () => TFakeResponse;
};

type TFetchEvent = {
  request: TFakeRequest;
  respondWith: (response: unknown) => void;
};

type TWorker = {
  getMediaCacheKey: (url: string) => string;
  isMediaRequest: (request: TFakeRequest, origin: string) => boolean;
  respondFromMediaCache: (request: TFakeRequest) => Promise<TFakeResponse>;
};

const origin = 'https://chat.example.com';

const listeners: Array<(event: TFetchEvent) => void> = [];

const fakeSelf = {
  location: { origin },
  addEventListener: (type: string, listener: (event: TFetchEvent) => void) => {
    if (type === 'fetch') {
      listeners.push(listener);
    }
  }
};

type TCacheState = {
  entries: Map<string, TFakeResponse>;
  fetchCalls: number;
  fetchResponse: TFakeResponse;
  cachesReject?: boolean;
};

const createFakeResponse = (
  body: string,
  { ok = true, type = 'basic' }: { ok?: boolean; type?: string } = {}
): TFakeResponse => ({
  ok,
  type,
  body,
  clone: () => createFakeResponse(body, { ok, type })
});

const installGlobals = (state: TCacheState) => {
  const cache = {
    keys: async () => [...state.entries.keys()],
    match: async (key: string | { url: string }) => {
      const url = typeof key === 'string' ? key : key.url;

      return state.entries.get(url);
    },
    put: async (key: string | { url: string }, response: TFakeResponse) => {
      const url = typeof key === 'string' ? key : key.url;

      state.entries.set(url, response);
    }
  };

  const fakeCaches = {
    open: async () => {
      if (state.cachesReject) {
        throw new Error('cache storage is unavailable');
      }

      return cache;
    },
    keys: async () => ['dodecagon-media-v1'],
    delete: async () => true
  };

  const fakeFetch = async () => {
    state.fetchCalls += 1;

    return state.fetchResponse;
  };

  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: fakeSelf,
    writable: true
  });
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: fakeCaches,
    writable: true
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fakeFetch,
    writable: true
  });
};

const workerPath = new URL(
  '../../../public/media-cache-worker.js',
  import.meta.url
).href;

installGlobals({
  entries: new Map(),
  fetchCalls: 0,
  fetchResponse: createFakeResponse('unused')
});

const worker: TWorker = await import(workerPath);

const createState = (
  fetchResponse: TFakeResponse = createFakeResponse('fresh')
): TCacheState => ({
  entries: new Map<string, TFakeResponse>(),
  fetchCalls: 0,
  fetchResponse
});

const createRequest = (
  url: string,
  { destination = 'image' }: { destination?: string } = {}
): TFakeRequest => ({
  method: 'GET',
  url,
  headers: new Headers(),
  destination
});

const results: Array<{ name: string; ok: boolean; error?: string }> = [];

const check = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: String(error) });
  }
};

const expectEqual = (actual: unknown, expected: unknown) => {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
};

const mediaUrl = `${origin}/public/avatar.png?v=abc123`;

await check('serves a hit without a network call', async () => {
  const state = createState();

  state.entries.set(mediaUrl, createFakeResponse('cached'));
  installGlobals(state);

  const response = await worker.respondFromMediaCache(
    createRequest(`${mediaUrl}&accessToken=token&expires=123`)
  );

  expectEqual(response.body, 'cached');
  expectEqual(state.fetchCalls, 0);
});

await check('fetches and stores a miss', async () => {
  const state = createState(createFakeResponse('fresh'));

  installGlobals(state);

  const response = await worker.respondFromMediaCache(
    createRequest(`${mediaUrl}&accessToken=token&expires=123`)
  );

  expectEqual(response.body, 'fresh');
  expectEqual(state.fetchCalls, 1);
  expectEqual(state.entries.has(mediaUrl), true);
  expectEqual(state.entries.get(mediaUrl)?.body, 'fresh');
});

await check('drops the token and the expiry from the key', async () => {
  const key = worker.getMediaCacheKey(
    `${mediaUrl}&accessToken=token&expires=123`
  );

  expectEqual(key, mediaUrl);
});

await check('ignores a request that is not an image', async () => {
  const documentRequest = createRequest(mediaUrl, { destination: 'document' });

  expectEqual(worker.isMediaRequest(documentRequest, origin), false);

  let responded = false;
  const [listener] = listeners;

  if (!listener) {
    throw new Error('the worker registered no fetch listener');
  }

  listener({
    request: documentRequest,
    respondWith: () => {
      responded = true;
    }
  });

  expectEqual(responded, false);
  expectEqual(worker.isMediaRequest(createRequest(mediaUrl), origin), true);
});

await check('does not store a response that is not ok', async () => {
  const state = createState(
    createFakeResponse('missing', { ok: false, type: 'basic' })
  );

  installGlobals(state);

  const response = await worker.respondFromMediaCache(createRequest(mediaUrl));

  expectEqual(response.body, 'missing');
  expectEqual(state.entries.size, 0);
});

await check('serves the network answer without cache storage', async () => {
  const state = {
    ...createState(createFakeResponse('fresh')),
    cachesReject: true
  };

  installGlobals(state);

  const response = await worker.respondFromMediaCache(createRequest(mediaUrl));

  expectEqual(response.body, 'fresh');
  expectEqual(state.fetchCalls, 1);
});

console.log(`__RESULT__${JSON.stringify(results)}`);
