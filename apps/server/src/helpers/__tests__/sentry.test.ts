import * as Sentry from '@sentry/bun';
import { TRPCError } from '@trpc/server';
import { afterEach, describe, expect, test } from 'bun:test';
import { captureError, initSentry, shouldReportError } from '../sentry';

describe('sentry', () => {
  const savedDsn = process.env.SENTRY_DSN;
  const savedEnvironment = process.env.SENTRY_ENVIRONMENT;

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
      return;
    }

    process.env[key] = value;
  };

  afterEach(async () => {
    restoreEnv('SENTRY_DSN', savedDsn);
    restoreEnv('SENTRY_ENVIRONMENT', savedEnvironment);
    await Sentry.close(0);
  });

  test('stays out of the way when no dsn is configured', () => {
    delete process.env.SENTRY_DSN;

    initSentry();

    expect(Sentry.getClient()).toBeUndefined();
    expect(() => captureError(new Error('boom'))).not.toThrow();
  });

  test('opens a client and reports errors once a dsn is configured', () => {
    process.env.SENTRY_DSN = 'https://public@errors.example.com/1';
    process.env.SENTRY_ENVIRONMENT = 'staging';

    initSentry();

    const client = Sentry.getClient();

    expect(client).toBeDefined();
    expect(client?.getOptions().dsn).toBe(
      'https://public@errors.example.com/1'
    );
    expect(client?.getOptions().environment).toBe('staging');
    expect(client?.getOptions().release).toBeDefined();
    expect(() => captureError(new Error('boom'))).not.toThrow();
  });

  test('keeps request bodies, contexts and user details out of events', () => {
    process.env.SENTRY_DSN = 'https://public@errors.example.com/1';

    initSentry();

    const beforeSend = Sentry.getClient()?.getOptions().beforeSend;

    expect(typeof beforeSend).toBe('function');

    const scrubbed = (
      beforeSend as unknown as (event: unknown, hint: unknown) => unknown
    )(
      {
        event_id: 'kept',
        request: { url: 'https://discord.example.com/trpc', data: {} },
        user: { id: 1 },
        contexts: {
          p2p: { session_ref: 'abc123', reason: 'deadline' },
          response: { body: 'chat message text' }
        },
        extra: { body: 'chat message text' },
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
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.contexts).toEqual({
      p2p: { session_ref: 'abc123', reason: 'deadline' }
    });
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.tags).toEqual({ area: 'voice' });
    expect(scrubbed.breadcrumbs).toEqual([
      { category: 'console', level: 'error', timestamp: 1 }
    ]);
  });

  test('reports unexpected failures and stays quiet about rejected input', () => {
    expect(shouldReportError(new TRPCError({ code: 'BAD_REQUEST' }))).toBe(
      false
    );
    expect(shouldReportError(new TRPCError({ code: 'FORBIDDEN' }))).toBe(false);
    expect(
      shouldReportError(new TRPCError({ code: 'INTERNAL_SERVER_ERROR' }))
    ).toBe(true);
    expect(shouldReportError(new Error('media worker died'))).toBe(true);
  });
});
