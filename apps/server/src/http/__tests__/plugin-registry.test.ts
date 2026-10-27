import { afterEach, describe, expect, test } from 'bun:test';
import { testsBaseUrl } from '../../__tests__/setup';
import { config } from '../../config';

// setup installs a tracking fetch before every test; keep that for the requests the
// test itself makes to the server and only answer for the registry host
const trackedFetch = globalThis.fetch;
const originalUrls = config.endpoints.marketplaceRegistryUrls;

const registryUrl = 'https://registry.example.test/plugins.json';

const entry = {
  plugin: {
    id: 'plugin-example',
    name: 'Example',
    description: 'a plugin',
    author: 'someone',
    logo: 'https://example.com/logo.png',
    verified: true
  },
  versions: [
    {
      version: '1.0.0',
      downloadUrl: 'https://example.com/plugin.tar.gz',
      checksum: 'deadbeef',
      sdkVersion: 1,
      size: 1000,
      timestamp: 1
    }
  ]
};

const serveRegistry = (status: number, body: unknown = []) => {
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    if (String(input) === registryUrl) {
      return Response.json(body, { status });
    }

    return trackedFetch(input, init);
  }) as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = trackedFetch;
  config.endpoints.marketplaceRegistryUrls = originalUrls;
});

describe('/plugins/registry', () => {
  test('should return the entries the configured registry host served', async () => {
    config.endpoints.marketplaceRegistryUrls = [registryUrl];
    serveRegistry(200, [entry]);

    const response = await fetch(`${testsBaseUrl}/plugins/registry`);

    expect(response.status).toBe(200);

    const data = (await response.json()) as { plugin: { id: string } }[];

    expect(data.map((row) => row.plugin.id)).toEqual(['plugin-example']);
  });

  test('should answer 502 when no registry host answers', async () => {
    config.endpoints.marketplaceRegistryUrls = [registryUrl];
    serveRegistry(500);

    const response = await fetch(`${testsBaseUrl}/plugins/registry`);

    expect(response.status).toBe(502);
  });

  test('should leave lookalike paths to the plugin route parser', async () => {
    const response = await fetch(`${testsBaseUrl}/plugins/registry-extra`);

    expect(response.status).toBe(404);
  });
});
