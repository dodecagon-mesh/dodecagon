import { describe, expect, test } from 'bun:test';
import { deepMerge } from '../../utils/deep-merge';

describe('deepMerge', () => {
  test('does not mutate the target object', () => {
    const target = { a: 1, b: { c: 2 } };
    const source = { b: { c: 99 } };

    const result = deepMerge(target, source);

    expect(result).toEqual({ a: 1, b: { c: 99 } });
    expect(target).toEqual({ a: 1, b: { c: 2 } });
  });

  test('does not mutate the source object', () => {
    const target = { a: { b: 1, c: 2 } };
    const source = { a: { b: 99 } } as Partial<typeof target>;

    const originalSource = structuredClone(source);

    deepMerge(target, source);

    expect(source).toEqual(originalSource);
  });

  test('overwrites arrays instead of merging them', () => {
    const target = { items: [1, 2, 3] };
    const source = { items: [4, 5] };

    expect(deepMerge(target, source)).toEqual({ items: [4, 5] });
  });

  test('works with the config.ini merge use case', () => {
    const defaultConfig = {
      server: { port: 4991, debug: false, autoupdate: false },
      http: { maxFiles: 40, maxFileSize: 100 },
      mediasoup: { webrtcPort: 40000, announcedAddress: '' }
    };

    const existingConfig: Partial<typeof defaultConfig> = {
      server: { port: 5000, debug: true },
      mediasoup: { webrtcPort: 50000 }
    } as Partial<typeof defaultConfig>;

    const result = deepMerge(defaultConfig, existingConfig);

    expect(result).toEqual({
      server: { port: 5000, debug: true, autoupdate: false },
      http: { maxFiles: 40, maxFileSize: 100 },
      mediasoup: { webrtcPort: 50000, announcedAddress: '' }
    });
  });

  test('preserves new default keys when existing config lacks them (ini.parse scenario)', () => {
    const defaultConfig = {
      server: { port: 4991, debug: false, autoupdate: false },
      webRtc: { port: 40000, announcedAddress: '', maxBitrate: 30000000 },
      rateLimiters: {
        sendAndEditMessage: { maxRequests: 15, windowMs: 60000 }
      }
    };

    // simulate an old config.ini that was written before maxBitrate existed
    const existingConfig = Object.create(null);

    existingConfig.server = Object.create(null);
    existingConfig.server.port = '5000';
    existingConfig.server.debug = true;
    existingConfig.server.autoupdate = false;
    existingConfig.webRtc = Object.create(null);
    existingConfig.webRtc.port = '40000';
    existingConfig.webRtc.announcedAddress = '';
    existingConfig.rateLimiters = Object.create(null);
    existingConfig.rateLimiters.sendAndEditMessage = Object.create(null);
    existingConfig.rateLimiters.sendAndEditMessage.maxRequests = '15';
    existingConfig.rateLimiters.sendAndEditMessage.windowMs = '60000';

    const result = deepMerge(defaultConfig, existingConfig);

    // maxBitrate should be preserved from default even though it wasn't in existing
    expect(result.webRtc.maxBitrate).toBe(30000000);
    // @ts-expect-error ini.parse returns all values as strings - zod will coerce them to the correct types when we parse the merged config, but deepMerge should just merge as-is
    expect(result.server.port).toBe('5000');
    expect(result.server.debug).toBe(true);
    // @ts-expect-error ini.parse returns all values as strings - zod will coerce them to the correct types when we parse the merged config, but deepMerge should just merge as-is
    expect(result.webRtc.port).toBe('40000');
  });
});
