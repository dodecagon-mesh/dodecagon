// a restart of the server resets the connections that are already open, so a
// server function that fails at the transport level is tried again before the
// caller sees an error. only a repeated GET is retried, a body cannot be sent
// twice safely
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const ATTEMPTS = 3;
const FIRST_DELAY_MS = 250;

type TFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

const retryingFetch: TFetch = async (input, init) => {
  const method = init?.method ?? 'GET';

  for (let attempt = 1; ; attempt += 1) {
    const lastAttempt = attempt >= ATTEMPTS || method !== 'GET';

    try {
      const response = await fetch(input, init);

      if (lastAttempt || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }

      await response.body?.cancel();
    } catch (error) {
      if (lastAttempt || init?.signal?.aborted) throw error;
    }

    const { promise, resolve } = Promise.withResolvers<void>();

    setTimeout(resolve, FIRST_DELAY_MS * attempt);

    await promise;
  }
};

export { retryingFetch };
