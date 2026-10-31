import {
  clearMediaCache,
  getMediaCacheStats,
  MEDIA_CACHE_NAME
} from '@/helpers/media-cache';
import { afterEach, describe, expect, test } from 'bun:test';

type TFakeBucket = Map<string, number>;

const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');

const defineCaches = (buckets: Map<string, TFakeBucket>) => {
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: async (name: string) => {
        const entries = buckets.get(name) ?? new Map<string, number>();

        buckets.set(name, entries);

        return {
          keys: async () => [...entries.keys()].map((key) => new Request(key)),
          match: async (key: Request | string) => {
            const url = typeof key === 'string' ? key : key.url;
            const size = entries.get(url);

            if (size === undefined) {
              return undefined;
            }

            return new Response(new Uint8Array(size));
          }
        };
      },
      keys: async () => [...buckets.keys()],
      delete: async (name: string) => buckets.delete(name)
    },
    writable: true
  });
};

const removeCaches = () => {
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: undefined,
    writable: true
  });
};

afterEach(() => {
  if (originalCaches) {
    Object.defineProperty(globalThis, 'caches', originalCaches);

    return;
  }

  removeCaches();
});

describe('media-cache', () => {
  test('should sum the sizes and entries of the media cache', async () => {
    const buckets = new Map<string, TFakeBucket>();

    buckets.set(
      MEDIA_CACHE_NAME,
      new Map([
        ['https://chat.example.com/public/a.png?v=1', 120],
        ['https://chat.example.com/public/b.png?v=2', 80]
      ])
    );
    defineCaches(buckets);

    expect(await getMediaCacheStats()).toEqual({ entries: 2, bytes: 200 });
  });

  test('should report nothing when the browser refuses the storage', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        open: async () => {
          throw new Error('SecurityError');
        },
        keys: async () => {
          throw new Error('SecurityError');
        }
      },
      writable: true
    });

    expect(await getMediaCacheStats()).toEqual({ entries: 0, bytes: 0 });
  });

  test('should delete only the media caches', async () => {
    const buckets = new Map<string, TFakeBucket>();

    buckets.set(MEDIA_CACHE_NAME, new Map());
    buckets.set('another-app-cache', new Map());
    defineCaches(buckets);

    await clearMediaCache();

    expect([...buckets.keys()]).toEqual(['another-app-cache']);
  });

  test('should stay safe when the browser has no cache storage', async () => {
    removeCaches();

    expect(await getMediaCacheStats()).toEqual({ entries: 0, bytes: 0 });
    expect(clearMediaCache()).resolves.toBeUndefined();
  });
});
