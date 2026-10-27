import * as Sentry from '@sentry/react';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  captureDiagnostic,
  captureError,
  initAppSentry,
  initSentry
} from '../sentry';

describe('sentry', () => {
  afterEach(async () => {
    await Sentry.close(0);
  });

  it('stays out of the way when no dsn is configured', () => {
    initSentry(undefined);

    expect(Sentry.getClient()).toBeUndefined();
    expect(() => captureError(new Error('boom'))).not.toThrow();
  });

  it('opens a client that reports errors once a dsn is configured', () => {
    initSentry('https://public@errors.example.com/2', 'production', '0.0.41');

    const client = Sentry.getClient();

    expect(client).toBeDefined();
    expect(client?.getOptions().dsn).toBe(
      'https://public@errors.example.com/2'
    );
    expect(client?.getOptions().environment).toBe('production');
    expect(client?.getOptions().release).toBe('0.0.41');
    expect(() => captureError(new Error('boom'))).not.toThrow();
  });

  it('reports with the dsn, environment and release of the deployment', () => {
    // the browser events of a production deployment were labelled
    // 'development' and carried no release, because the dsn that arrived with
    // the public settings opened the client without them
    Object.assign(globalThis, {
      __DODECAGON_ERRORS__: {
        dsn: 'https://client@errors.example.com/2',
        environment: 'production'
      },
      VITE_APP_VERSION: '1.2.3'
    });

    try {
      initAppSentry();

      const options = Sentry.getClient()?.getOptions();

      expect(options?.dsn).toBe('https://client@errors.example.com/2');
      expect(options?.environment).toBe('production');
      expect(options?.release).toBe('1.2.3');
    } finally {
      Reflect.deleteProperty(globalThis, '__DODECAGON_ERRORS__');
      Reflect.deleteProperty(globalThis, 'VITE_APP_VERSION');
    }
  });

  it('keeps the environment of the deployment when the server sends its dsn', () => {
    Object.assign(globalThis, {
      __DODECAGON_ERRORS__: {
        dsn: 'https://rendered@errors.example.com/2',
        environment: 'production'
      },
      VITE_APP_VERSION: '1.2.3'
    });

    try {
      initAppSentry('https://settings@errors.example.com/2');

      const options = Sentry.getClient()?.getOptions();

      expect(options?.dsn).toBe('https://settings@errors.example.com/2');
      expect(options?.environment).toBe('production');
      expect(options?.release).toBe('1.2.3');
    } finally {
      Reflect.deleteProperty(globalThis, '__DODECAGON_ERRORS__');
      Reflect.deleteProperty(globalThis, 'VITE_APP_VERSION');
    }
  });

  it('passes a P2P diagnostic to the tracker with its fingerprint', () => {
    initSentry('https://public@errors.example.com/2');
    const capture = spyOn(Sentry, 'captureEvent');

    try {
      captureDiagnostic({
        level: 'warning',
        message: 'voice.p2p',
        tags: { area: 'voice', 'p2p.reason': 'native_closed_early' },
        contexts: { p2p: { session_ref: 'abc123' } },
        fingerprint: ['voice.p2p', 'audio', 'sender', 'relay']
      });

      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0]?.[0]).toMatchObject({
        level: 'warning',
        message: 'voice.p2p',
        fingerprint: ['voice.p2p', 'audio', 'sender', 'relay']
      });
    } finally {
      capture.mockRestore();
    }
  });

  it('keeps chat content out of reported events', () => {
    initSentry('https://public@errors.example.com/2');

    const beforeSend = Sentry.getClient()?.getOptions().beforeSend;

    expect(typeof beforeSend).toBe('function');

    const scrubbed = (
      beforeSend as unknown as (event: unknown, hint: unknown) => unknown
    )(
      {
        event_id: 'kept',
        request: { url: '/trpc', data: { message: 'chat text' } },
        user: { email: 'person@example.com' },
        contexts: {
          p2p: { session_ref: 'abc123', phases: [] },
          browser: { name: 'Chrome', version: '1.0' },
          os: { name: 'Linux', version: '6.0' },
          response: { body: 'chat text' }
        },
        extra: { message: 'chat text' },
        tags: { area: 'voice', url: 'https://example.com/?token=secret' },
        breadcrumbs: [
          {
            category: 'console',
            level: 'error',
            timestamp: 1,
            message: 'token=secret',
            data: { url: 'https://example.com/?token=secret' }
          }
        ]
      },
      {}
    ) as Record<string, unknown>;

    expect(scrubbed.event_id).toBe('kept');
    expect(scrubbed.tags).toEqual({ area: 'voice' });
    expect(scrubbed.contexts).toEqual({
      browser: { name: 'Chrome', version: '1.0' },
      os: { name: 'Linux', version: '6.0' },
      p2p: { session_ref: 'abc123', phases: [] }
    });
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'console', level: 'error', timestamp: 1 }
    ]);
  });
});
