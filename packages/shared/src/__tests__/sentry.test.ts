import { describe, expect, test } from 'bun:test';
import { readPublicSentryDsn } from '../sentry';

// the dsn travels into the html of every page, so it must be the one the
// operator configured and nothing else
describe('the public sentry dsn', () => {
  test('is absent when the deployment reports nowhere', () => {
    expect(readPublicSentryDsn({})).toBeNull();
    expect(readPublicSentryDsn({ SENTRY_DSN: '   ' })).toBeNull();
  });

  test('prefers the client project and falls back to the server one', () => {
    expect(
      readPublicSentryDsn({
        SENTRY_DSN: 'https://server@errors.example.com/1',
        SENTRY_CLIENT_DSN: 'https://client@errors.example.com/2'
      })
    ).toBe('https://client@errors.example.com/2');

    expect(
      readPublicSentryDsn({
        SENTRY_DSN: 'https://server@errors.example.com/1'
      })
    ).toBe('https://server@errors.example.com/1');
  });

  test('drops a value that is not an http url', () => {
    expect(
      readPublicSentryDsn({ SENTRY_DSN: 'javascript:alert(1)' })
    ).toBeNull();
    expect(readPublicSentryDsn({ SENTRY_DSN: 'not a dsn' })).toBeNull();
  });
});
