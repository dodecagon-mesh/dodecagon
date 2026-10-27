import { afterEach, describe, expect, test } from 'bun:test';
import { retryingFetch } from '../retrying-fetch';

const originalFetch = globalThis.fetch;

const stubFetch = (answers: Array<() => Promise<Response>>) => {
  let calls = 0;
  const stub = async () => {
    const answer = answers[Math.min(calls, answers.length - 1)]!;
    calls += 1;

    return answer();
  };

  // the runtime fetch carries a Bun-only preconnect that the stub does not need
  globalThis.fetch = stub as unknown as typeof fetch;

  return () => calls;
};

const connectionReset = () => Promise.reject(new TypeError('Failed to fetch'));
const status = (code: number) => async () =>
  new Response(null, { status: code });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the retrying fetch', () => {
  test('retries a connection that was reset during a restart', async () => {
    const calls = stubFetch([connectionReset, connectionReset, status(200)]);

    const response = await retryingFetch('http://localhost/_serverFn/id');

    expect(response.status).toBe(200);
    expect(calls()).toBe(3);
  });

  test('retries a gateway that is not ready yet', async () => {
    const calls = stubFetch([status(503), status(200)]);

    const response = await retryingFetch('http://localhost/_serverFn/id');

    expect(response.status).toBe(200);
    expect(calls()).toBe(2);
  });

  test('does not retry an answer of the server', async () => {
    const calls = stubFetch([status(404)]);

    const response = await retryingFetch('http://localhost/_serverFn/id');

    expect(response.status).toBe(404);
    expect(calls()).toBe(1);
  });

  test('does not retry a request with a body', async () => {
    const calls = stubFetch([connectionReset, status(200)]);

    await expect(
      retryingFetch('http://localhost/_serverFn/id', {
        method: 'POST',
        body: '{}'
      })
    ).rejects.toThrow('Failed to fetch');
    expect(calls()).toBe(1);
  });
});
