import { DisconnectCode } from '@dodecagon/shared';
import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { config } from '../config';
import { createWsServer } from '../utils/wss';
import { createMockContext } from './context';
import { getCaller, getMockedToken } from './helpers';
import { findTestLog } from './setup';

const PROXY_ADDRESS = '203.0.113.9';
const CLIENT_ADDRESS = '198.51.100.7';

const originalTrustedProxies = [...config.server.trustedProxies];

afterEach(() => {
  config.server.trustedProxies = [...originalTrustedProxies];
});

const createConnection = async (
  opts: Omit<Parameters<typeof createMockContext>[0], 'customToken'>
) => createMockContext({ ...opts, customToken: await getMockedToken(1) });

describe('connection info through createContext', () => {
  test('should report the socket address when no headers are present', async () => {
    const ctx = await createConnection({ remoteAddress: CLIENT_ADDRESS });

    expect(ctx.getConnectionInfo()?.ip).toBe(CLIENT_ADDRESS);
  });

  test('should ignore forwarded headers from an untrusted socket', async () => {
    const ctx = await createConnection({
      remoteAddress: CLIENT_ADDRESS,
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'x-real-ip': '5.6.7.8',
        'cf-connecting-ip': '9.10.11.12'
      }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe(CLIENT_ADDRESS);
  });

  test('should honour forwarded headers from a trusted proxy', async () => {
    config.server.trustedProxies = [PROXY_ADDRESS];

    const ctx = await createConnection({
      remoteAddress: PROXY_ADDRESS,
      headers: { 'x-forwarded-for': '1.2.3.4' }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe('1.2.3.4');
  });

  test('should honour a trusted proxy matched by cidr range', async () => {
    config.server.trustedProxies = ['203.0.113.0/24'];

    const ctx = await createConnection({
      remoteAddress: PROXY_ADDRESS,
      headers: { 'x-forwarded-for': '1.2.3.4' }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe('1.2.3.4');
  });

  test('should take the right-most address the proxy chain did not add', async () => {
    config.server.trustedProxies = [PROXY_ADDRESS, '10.0.0.0/8'];

    const ctx = await createConnection({
      remoteAddress: PROXY_ADDRESS,
      headers: { 'x-forwarded-for': `${CLIENT_ADDRESS}, 10.0.0.1` }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe(CLIENT_ADDRESS);
  });

  // nginx's standard `$proxy_add_x_forwarded_for` keeps whatever the client sent and
  // appends the address it connected from, so the left half of the chain is caller
  // controlled. reading it is how a caller gets a fresh rate limit bucket per request
  test('should ignore an address the client prepended to the chain', async () => {
    config.server.trustedProxies = [PROXY_ADDRESS];

    const ctx = await createConnection({
      remoteAddress: PROXY_ADDRESS,
      headers: { 'x-forwarded-for': `1.2.3.4, ${CLIENT_ADDRESS}` }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe(CLIENT_ADDRESS);
  });

  // a proxy that does not overwrite them passes these straight through, and nothing in
  // the value says whether the proxy or the caller wrote it
  test('should ignore single-value vendor headers from a trusted proxy', async () => {
    config.server.trustedProxies = [PROXY_ADDRESS];

    const ctx = await createConnection({
      remoteAddress: PROXY_ADDRESS,
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'x-real-ip': '1.2.3.4',
        'x-forwarded-for': CLIENT_ADDRESS
      }
    });

    expect(ctx.getConnectionInfo()?.ip).toBe(CLIENT_ADDRESS);
  });

  test('should parse the user agent end to end', async () => {
    const ctx = await createConnection({
      remoteAddress: CLIENT_ADDRESS,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });

    const info = ctx.getConnectionInfo();

    expect(info?.os).toContain('macOS');
    expect(info?.device).toBe('Desktop');
  });
});

describe('rate limiting subject', () => {
  const exhaustJoinServer = async (
    userId: number,
    remoteAddress: string,
    headers?: Record<string, string>
  ) => {
    const { caller } = await getCaller(userId, { remoteAddress, headers });

    // joinServer spends a slot only on a rejected attempt, and allows 5 of them per minute.
    // A wrong handshake is exactly the guess the limit answers
    for (let i = 0; i < 5; i++) {
      await expect(
        caller.others.joinServer({ handshakeHash: 'not-a-handshake' })
      ).rejects.toThrow('Invalid handshake hash');
    }

    return caller;
  };

  test('should follow the user across addresses rather than the address', async () => {
    const offender = await exhaustJoinServer(1, CLIENT_ADDRESS);
    const { handshakeHash } = await offender.others.handshake();

    await expect(offender.others.joinServer({ handshakeHash })).rejects.toThrow(
      'Too many requests. Please try again shortly.'
    );

    // same user from a different address is still the same subject
    const { caller: moved } = await getCaller(1, {
      remoteAddress: '203.0.113.55'
    });
    const movedHandshake = await moved.others.handshake();

    await expect(
      moved.others.joinServer({ handshakeHash: movedHandshake.handshakeHash })
    ).rejects.toThrow('Too many requests. Please try again shortly.');
  });

  test('should not punish a second user behind the same address', async () => {
    await exhaustJoinServer(1, CLIENT_ADDRESS);

    // the point of keying on the user: one noisy account must not lock out everyone
    // sharing its NAT
    const { caller: neighbour } = await getCaller(2, {
      remoteAddress: CLIENT_ADDRESS
    });
    const { handshakeHash } = await neighbour.others.handshake();

    expect(await neighbour.others.joinServer({ handshakeHash })).toBeDefined();
  });
});

// the logger is silenced for the whole suite, so before the test log sink existed a path that
// caught an error, logged it and carried on looked exactly like success
describe('test log sink', () => {
  test('should record the warning when a request has no identifiable ip', async () => {
    const mockedToken = await getMockedToken(1);
    const ctx = await createMockContext({
      customToken: mockedToken,
      remoteAddress: ''
    });

    expect(ctx.getConnectionInfo()?.ip).toBeUndefined();

    const { caller } = await getCaller(1, { remoteAddress: '' });

    await caller.others.handshake();

    expect(
      findTestLog('warn', 'Missing IP address in connection info')
    ).toBeDefined();
  });
});

test('invalid connection credentials close with an explicit terminal authentication code', async () => {
  const server = createServer();
  const sockets = await createWsServer(server);
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address() as AddressInfo;
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/?connectionParams=1`
  );
  try {
    const closed = Promise.withResolvers<number>();
    socket.once('error', closed.reject);
    socket.once('close', closed.resolve);
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          method: 'connectionParams',
          data: { token: 'invalid-token' }
        })
      );
    });
    expect(await closed.promise).toBe(DisconnectCode.AUTHENTICATION_FAILED);
  } finally {
    socket.terminate();
    const socketsClosed = Promise.withResolvers<void>();
    sockets.close(() => socketsClosed.resolve());
    await socketsClosed.promise;
    const serverClosed = Promise.withResolvers<void>();
    server.close(() => serverClosed.resolve());
    await serverClosed.promise;
  }
});
