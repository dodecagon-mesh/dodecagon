import { describe, expect, test } from 'bun:test';
import type http from 'http';
import { getPreferredEncoding } from '../compression';

const requestWith = (header?: string) =>
  ({
    headers: header === undefined ? {} : { 'accept-encoding': header }
  }) as http.IncomingMessage;

describe('response compression negotiation', () => {
  test('prefers brotli when both encodings are accepted', () => {
    expect(getPreferredEncoding(requestWith('gzip, br'))).toBe('br');
  });

  test('falls back to gzip when brotli is not accepted', () => {
    expect(getPreferredEncoding(requestWith('gzip'))).toBe('gzip');
  });

  test('honours a zero quality and uses the remaining encoding', () => {
    expect(getPreferredEncoding(requestWith('br;q=0, gzip;q=1'))).toBe('gzip');
    expect(getPreferredEncoding(requestWith('br;q=1, gzip;q=0'))).toBe('br');
  });

  test('uses a wildcard as a fallback for both encodings', () => {
    expect(getPreferredEncoding(requestWith('*'))).toBe('br');
  });

  test('returns undefined when no supported encoding is accepted', () => {
    expect(getPreferredEncoding(requestWith('deflate'))).toBeUndefined();
    expect(getPreferredEncoding(requestWith())).toBeUndefined();
    expect(
      getPreferredEncoding(requestWith('br;q=0, gzip;q=0'))
    ).toBeUndefined();
  });
});
