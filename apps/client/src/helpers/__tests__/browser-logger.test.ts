import { describe, expect, it, spyOn } from 'bun:test';
import { logVoice, logVoiceError, logVoiceWarn } from '../browser-logger';

const lastArg = (call: unknown[] | undefined): unknown =>
  call?.[call.length - 1];

describe('browser logger', () => {
  it('hands the console a line instead of an object', () => {
    // the desktop bridge flattens console arguments to text, so a raw object
    // reached renderer.log as "[object Object]" with the reason missing
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      logVoiceError(
        'direct media: failed',
        new Error('Holepunch connection ended'),
        { kind: 'audio' }
      );

      const call = spy.mock.calls[0] ?? [];
      const detail = lastArg(call);

      expect(call.slice(2)).toHaveLength(2);
      expect(typeof detail).toBe('string');
      expect(JSON.parse(detail as string)).toEqual({
        kind: 'audio',
        error: { name: 'Error', message: 'Holepunch connection ended' }
      });
      expect(detail).not.toContain('[object Object]');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the code of a plain object failure in the line', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});

    try {
      logVoiceError('direct media: failed', {
        message: 'peer fell back',
        data: { code: 'BAD_REQUEST' }
      });

      expect(JSON.parse(lastArg(spy.mock.calls[0]) as string)).toEqual({
        code: 'BAD_REQUEST',
        error: {
          name: 'Object',
          message: 'peer fell back',
          code: 'BAD_REQUEST'
        }
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('prints the data of a voice and a warning line as text', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      logVoice('transport closed', { codec: 'opus' });
      logVoiceWarn('slow consumer', { peer: 2 });

      expect(lastArg(log.mock.calls[0])).toBe('{"codec":"opus"}');
      expect(lastArg(warn.mock.calls[0])).toBe('{"peer":2}');
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });

  it('adds no argument when a line carries no data', () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});

    try {
      logVoice('channel joined');

      expect(log.mock.calls[0]?.slice(2)).toEqual(['channel joined']);
    } finally {
      log.mockRestore();
    }
  });
});
