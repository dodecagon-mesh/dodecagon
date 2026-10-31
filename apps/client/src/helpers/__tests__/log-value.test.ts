import { describe, expect, it } from 'bun:test';
import { toLogText } from '../log-value';

describe('toLogText', () => {
  it('keeps the name, the message and the code of an error', () => {
    const error = Object.assign(new Error('Holepunch connection ended'), {
      data: { code: 'SERVICE_UNAVAILABLE' }
    });

    expect(JSON.parse(toLogText({ kind: 'audio', error }))).toEqual({
      kind: 'audio',
      error: {
        name: 'Error',
        message: 'Holepunch connection ended',
        code: 'SERVICE_UNAVAILABLE'
      }
    });
  });

  it('describes an error that is not an Error instance', () => {
    // a trpc failure reaches the voice provider as a plain object, which the
    // bridge used to print as "[object Object]"
    const error = { message: 'peer left', data: { code: 'BAD_REQUEST' } };

    expect(JSON.parse(toLogText(error))).toEqual({
      name: 'Object',
      message: 'peer left',
      code: 'BAD_REQUEST'
    });
  });

  it('follows a cause', () => {
    const error = new Error('media link is not ready', {
      cause: new Error('bootstrap failed')
    });

    expect(JSON.parse(toLogText(error)).cause).toEqual({
      name: 'Error',
      message: 'bootstrap failed'
    });
  });

  it('reports a cycle instead of throwing', () => {
    const value: Record<string, unknown> = { kind: 'screen' };
    value.self = value;

    expect(JSON.parse(toLogText(value))).toEqual({
      kind: 'screen',
      self: '[Circular]'
    });
  });

  it('stops at a depth and at an entry count a line can carry', () => {
    const deep = { a: { b: { c: { d: 'too deep' } } } };
    const many = Array.from({ length: 30 }, (_, index) => index);

    expect(JSON.parse(toLogText(deep))).toEqual({
      a: { b: { c: '[Object]' } }
    });
    expect(JSON.parse(toLogText(many))).toHaveLength(20);
  });

  it('keeps a long string readable instead of losing it to the line limit', () => {
    const text = toLogText('x'.repeat(5000));

    expect(text.length).toBeLessThanOrEqual(301);
    expect(text.endsWith('…')).toBe(true);
  });

  it('returns a bare string unquoted and a primitive as text', () => {
    expect(toLogText('Holepunch connection ended')).toBe(
      'Holepunch connection ended'
    );
    expect(toLogText(42)).toBe('42');
    expect(toLogText(undefined)).toBe('undefined');
  });

  it('never throws on a value that cannot be serialized', () => {
    const value = {
      get boom(): never {
        throw new Error('getter');
      },
      toJSON: () => {
        throw new Error('toJSON');
      }
    };

    expect(toLogText(value)).toBe('[unserializable]');
  });
});
