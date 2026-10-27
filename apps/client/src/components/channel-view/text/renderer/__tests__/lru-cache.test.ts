import { describe, expect, test } from 'bun:test';
import { readFromCache, writeToCache } from '../lru-cache';

const MAX_CACHE_SIZE = 500;

const fill = (cache: Map<string, number>, count: number) => {
  for (let index = 0; index < count; index++) {
    writeToCache(cache, `key-${index}`, index);
  }
};

describe('readFromCache', () => {
  // the reason this is an lru and not a queue: scrolling upwards re-renders the oldest
  // messages first, so plain insertion order evicts exactly what is about to be asked for
  test('should move a key it reads to the back of the eviction order', () => {
    const cache = new Map<string, number>();

    writeToCache(cache, 'oldest', 1);
    writeToCache(cache, 'newer', 2);

    expect([...cache.keys()]).toEqual(['oldest', 'newer']);

    readFromCache(cache, 'oldest');

    expect([...cache.keys()]).toEqual(['newer', 'oldest']);
  });
});

describe('writeToCache', () => {
  test('should evict the least recently used key rather than the oldest written', () => {
    const cache = new Map<string, number>();

    fill(cache, MAX_CACHE_SIZE);

    // key-0 is the oldest write, and reading it is what has to save it
    readFromCache(cache, 'key-0');

    writeToCache(cache, 'overflow', -1);

    expect(cache.has('key-0')).toBe(true);
    expect(cache.has('key-1')).toBe(false);
    expect(cache.size).toBe(MAX_CACHE_SIZE);
  });
});
