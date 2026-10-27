import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../../config';
import {
  fetchMarketplaceRegistry,
  fetchMarketplaceVersion
} from '../marketplace';

const realFetch = globalThis.fetch;
const originalUrls = config.endpoints.marketplaceRegistryUrls;

const primary = 'https://registry.example.test/plugins.json';
const mirror = 'https://mirror.example.test/plugins.json';

const entry = (id: string, version: string = '1.0.0') => ({
  plugin: {
    id,
    name: id,
    description: 'a plugin',
    author: 'someone',
    logo: 'https://example.com/logo.png',
    verified: true
  },
  versions: [
    {
      version,
      downloadUrl: 'https://example.com/plugin.tar.gz',
      checksum: 'deadbeef',
      sdkVersion: 1,
      size: 1000,
      timestamp: 1
    }
  ]
});

const useUrls = (...urls: string[]) => {
  config.endpoints.marketplaceRegistryUrls = urls;
};

// handlers are keyed by url, so a test decides per host whether it answers, fails
// or throws, and the returned array records the order the mirrors were asked
const serve = (handlers: Record<string, () => Response>) => {
  const seen: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);

    seen.push(url);

    const handler = handlers[url];

    return handler ? handler() : Response.json({}, { status: 404 });
  }) as typeof fetch;

  return seen;
};

afterEach(() => {
  globalThis.fetch = realFetch;
  config.endpoints.marketplaceRegistryUrls = originalUrls;
});

describe('fetchMarketplaceRegistry', () => {
  test('should return the parsed entries of the first answering host', async () => {
    useUrls(primary);
    serve({ [primary]: () => Response.json([entry('plugin-example')]) });

    const entries = await fetchMarketplaceRegistry();

    expect(entries.map((e) => e.plugin.id)).toEqual(['plugin-example']);
  });

  test('should fall back to the next mirror when a host answers with an error', async () => {
    useUrls(primary, mirror);

    const seen = serve({
      [primary]: () => Response.json({}, { status: 503 }),
      [mirror]: () => Response.json([entry('plugin-example')])
    });

    const entries = await fetchMarketplaceRegistry();

    expect(seen).toEqual([primary, mirror]);
    expect(entries).toHaveLength(1);
  });

  test('should fall back to the next mirror when a host throws', async () => {
    useUrls(primary, mirror);

    const seen = serve({
      [primary]: () => {
        throw new TypeError('connection reset');
      },
      [mirror]: () => Response.json([entry('plugin-example')])
    });

    const entries = await fetchMarketplaceRegistry();

    expect(seen).toEqual([primary, mirror]);
    expect(entries).toHaveLength(1);
  });

  test('should name every host in the error when all of them fail', async () => {
    useUrls(primary, mirror);
    serve({
      [primary]: () => Response.json({}, { status: 500 }),
      [mirror]: () => Response.json({}, { status: 404 })
    });

    await expect(fetchMarketplaceRegistry()).rejects.toThrow(
      `Failed to fetch marketplace registry (${primary}: HTTP 500; ${mirror}: HTTP 404)`
    );
  });
});

describe('fetchMarketplaceVersion', () => {
  test('should return the requested version of a listed plugin', async () => {
    useUrls(primary);
    serve({ [primary]: () => Response.json([entry('plugin-example')]) });

    const version = await fetchMarketplaceVersion('plugin-example', '1.0.0');

    expect(version.downloadUrl).toBe('https://example.com/plugin.tar.gz');
    expect(version.checksum).toBe('deadbeef');
  });

  // the schema drops bad entries rather than failing the whole registry, so an entry that does
  // not parse is simply not there. installing it has to fail like any unknown plugin, which is
  // what makes a plugin "silently missing from the list" the visible symptom of a schema failure
  test('should not find a plugin whose entry failed the schema', async () => {
    const poisoned = entry('plugin-poisoned');

    poisoned.plugin.logo = 'javascript:alert(1)';

    useUrls(primary);
    serve({
      [primary]: () => Response.json([entry('plugin-example'), poisoned])
    });

    await expect(
      fetchMarketplaceVersion('plugin-poisoned', '1.0.0')
    ).rejects.toThrow("Plugin 'plugin-poisoned' not found in marketplace");

    // the valid entry alongside it still installs, so one bad row cannot take the rest down
    await expect(
      fetchMarketplaceVersion('plugin-example', '1.0.0')
    ).resolves.toBeDefined();
  });

  test('should refuse a plugin that is not listed at all', async () => {
    useUrls(primary);
    serve({ [primary]: () => Response.json([entry('plugin-example')]) });

    await expect(
      fetchMarketplaceVersion('plugin-missing', '1.0.0')
    ).rejects.toThrow("Plugin 'plugin-missing' not found in marketplace");
  });

  test('should refuse a version the listed plugin does not have', async () => {
    useUrls(primary);
    serve({
      [primary]: () => Response.json([entry('plugin-example', '1.0.0')])
    });

    await expect(
      fetchMarketplaceVersion('plugin-example', '2.0.0')
    ).rejects.toThrow("Version '2.0.0' not found for plugin 'plugin-example'");
  });

  test('should refuse a registry none of the hosts served', async () => {
    useUrls(primary);
    serve({ [primary]: () => Response.json({}, { status: 502 }) });

    await expect(
      fetchMarketplaceVersion('plugin-example', '1.0.0')
    ).rejects.toThrow('Failed to fetch marketplace registry');
  });
});
