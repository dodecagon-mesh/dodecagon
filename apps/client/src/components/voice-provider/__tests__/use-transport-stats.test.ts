import { StreamKind } from '@dodecagon/shared';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { AppData, Producer, Transport } from 'mediasoup-client/types';
import * as React from 'react';
import type { TransportStatsData } from '../hooks/use-transport-stats';

// Exercise the actual hook; Bun has no React DOM. Keep state writes and effect
// cleanup observable, and drive its real interval callbacks deterministically.
let state: TransportStatsData;
let stateWrites = 0;
let cleanups: (() => void)[] = [];
// the react mock stays registered for the whole test run, so the effects of
// the other components would run inside their render and break them
let insideTheHook = false;
mock.module('react', () => ({
  ...React,
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: TransportStatsData) => {
    state = initial;
    return [
      initial,
      (
        update:
          | TransportStatsData
          | ((previous: TransportStatsData) => TransportStatsData)
      ) => {
        state = typeof update === 'function' ? update(state) : update;
        stateWrites++;
      }
    ];
  },
  useEffect: (effect: () => (() => void) | void) => {
    if (!insideTheHook) {
      return;
    }

    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
}));
mock.module('@/helpers/browser-logger', () => ({
  logVoice: () => {},
  logVoiceWarn: () => {},
  logVoiceError: () => {},
  logDebug: () => {}
}));
const pingServer = mock(async (): Promise<null> => null);
const trpc = { others: { ping: { query: pingServer } } };
mock.module('@/lib/trpc', () => ({ getTRPCClient: () => trpc }));
const { useTransportStats: useTransportStatsHook } =
  await import('../hooks/use-transport-stats');

// only the hook under test owns the effects, the rest of the test run shares
// the react mock with the components it renders
const useTransportStats = (
  ...args: Parameters<typeof useTransportStatsHook>
) => {
  insideTheHook = true;

  try {
    return useTransportStatsHook(...args);
  } finally {
    insideTheHook = false;
  }
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
const report = (bytesSent = 100, bytesReceived = 200) =>
  new Map([
    [
      'out',
      {
        type: 'outbound-rtp',
        kind: 'video',
        id: 'out',
        bytesSent,
        frameWidth: 1280,
        frameHeight: 720
      }
    ],
    ['in', { type: 'inbound-rtp', bytesReceived }]
  ]) as unknown as RTCStatsReport;
const transport = (getStats: () => Promise<RTCStatsReport>) =>
  ({ getStats }) as unknown as Transport;
const screenProducer = (getStats: () => Promise<RTCStatsReport>) =>
  ({ getStats, closed: false }) as unknown as Producer<AppData>;

const originalInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalWindow = globalThis.window;
let timers = new Map<number, () => void>();
let nextTimer = 0;
const tick = async (count = 1) => {
  for (let index = 0; index < count; index++) {
    for (const callback of [...timers.values()]) callback();
    await flush();
  }
};
beforeEach(() => {
  pingServer.mockReset();
  pingServer.mockResolvedValue(null);
  stateWrites = 0;
  cleanups = [];
  timers = new Map();
  nextTimer = 0;
  globalThis.window = {} as Window & typeof globalThis;
  globalThis.setInterval = ((callback: () => void) => {
    const id = ++nextTimer;
    timers.set(id, callback);
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) =>
    timers.delete(id)) as unknown as typeof clearInterval;
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.window = originalWindow;
});

test('control RTT is separate and a pending ping never blocks or multiplies media sampling', async () => {
  const pending = deferred<null>();
  pingServer.mockImplementationOnce(() => pending.promise);
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(transport(async () => report()));
  try {
    await tick(10);
    expect(state.producer?.bytesSent).toBe(100);
    expect(pingServer).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ serverRtt: null, peerRtts: {} });
    pending.resolve(null);
    await flush();
    await tick();
    expect(state).toMatchObject({
      serverRtt: expect.any(Number),
      peerRtts: {}
    });
  } finally {
    pending.resolve(null);
    await flush();
  }
});

test('peer ping uses the selected direct candidate pair and direct traffic is counted', async () => {
  const stats = new Map<string, unknown>(report(700, 900));
  stats.set('selected', {
    id: 'selected',
    type: 'candidate-pair',
    state: 'succeeded',
    currentRoundTripTime: 0.019
  });
  stats.set('other', {
    id: 'other',
    type: 'candidate-pair',
    state: 'succeeded',
    currentRoundTripTime: 0.31
  });
  stats.set('transport', {
    id: 'transport',
    type: 'transport',
    selectedCandidatePairId: 'selected'
  });
  const connection = {
    connectionState: 'connected',
    getStats: mock(async () => stats)
  } as unknown as RTCPeerConnection;
  const hook = useTransportStats([
    {
      getConnections: () => [
        {
          peerId: 2,
          kind: StreamKind.AUDIO,
          direction: 'outgoing' as const,
          connection
        }
      ]
    }
  ]);
  hook.subscribe();
  hook.startMonitoring(transport(async () => report(0, 0)));
  await flush();
  expect(state).toMatchObject({
    peerRtts: { 2: 19 },
    totalBytesSent: 700,
    totalBytesReceived: 900
  });
});

test('screen quality reflects active direct media rather than paused relay standby', async () => {
  const relay = new Map<string, unknown>(report());
  (relay.get('out') as Record<string, unknown>).qualityLimitationReason =
    'bandwidth';
  const direct = new Map<string, unknown>(report());
  (direct.get('out') as Record<string, unknown>).qualityLimitationReason =
    'none';
  const connection = {
    connectionState: 'connected',
    getStats: async () => direct
  } as unknown as RTCPeerConnection;
  const hook = useTransportStats([
    {
      getConnections: () => [
        {
          peerId: 2,
          kind: StreamKind.SCREEN,
          direction: 'outgoing' as const,
          connection
        }
      ]
    }
  ]);
  hook.subscribe();
  hook.setScreenShareProducer({
    ...screenProducer(async () => relay as unknown as RTCStatsReport),
    paused: true
  } as Producer<AppData>);
  hook.startMonitoring(transport(async () => report()));
  await flush();
  expect(state.screenShare?.qualityLimitationReason).toBe('none');
});

test('a new session polls without waiting for the old session and ignores its late result', async () => {
  const pending = deferred<RTCStatsReport>();
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(transport(() => pending.promise));
  hook.stopMonitoring();
  const newGetStats = mock(async () => report(500));
  hook.startMonitoring(transport(newGetStats));
  await flush();
  expect(newGetStats).toHaveBeenCalledTimes(1);
  expect(state.producer?.bytesSent).toBe(500);
  const writes = stateWrites;
  pending.resolve(report(100));
  await flush();
  expect(state.producer?.bytesSent).toBe(500);
  expect(stateWrites).toBe(writes);
});

for (const role of ['producer', 'consumer', 'screenShare'] as const) {
  test(`a pending ${role} request bounds the entire polling collection`, async () => {
    const pending = deferred<RTCStatsReport>();
    const getStats = mock(() => pending.promise);
    const fastGetStats = mock(async () => report());
    const hook = useTransportStats();
    hook.subscribe();
    if (role === 'screenShare')
      hook.setScreenShareProducer(screenProducer(getStats));
    hook.startMonitoring(
      transport(role === 'producer' ? getStats : fastGetStats),
      transport(role === 'consumer' ? getStats : fastGetStats)
    );
    await flush();
    await tick(100);
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(fastGetStats.mock.calls.length).toBeLessThanOrEqual(2);
    expect(stateWrites).toBe(0);
    pending.resolve(report());
    await flush();
    expect(stateWrites).toBe(1);
    await tick();
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(stateWrites).toBe(2);
  });

  for (const rejects of [false, true]) {
    test(`cleanup ignores late ${role} ${rejects ? 'rejection' : 'resolution'}`, async () => {
      const pending = deferred<RTCStatsReport>();
      const hook = useTransportStats();
      hook.subscribe();
      if (role === 'screenShare')
        hook.setScreenShareProducer(screenProducer(() => pending.promise));
      hook.startMonitoring(
        transport(
          role === 'producer' ? () => pending.promise : async () => report()
        ),
        transport(
          role === 'consumer' ? () => pending.promise : async () => report()
        )
      );
      await flush();
      for (const cleanup of cleanups) cleanup();
      const writes = stateWrites;
      if (rejects) pending.reject(new Error('closed'));
      else pending.resolve(report());
      await flush();
      expect(stateWrites).toBe(writes);
      expect(timers.size).toBe(0);
    });
  }
}

test('restarting the same object does not release a pending request slot', async () => {
  const pending = deferred<RTCStatsReport>();
  const getStats = mock(() => pending.promise);
  const target = transport(getStats);
  const hook = useTransportStats();
  const unsubscribe = hook.subscribe();
  hook.startMonitoring(target);
  unsubscribe();
  hook.subscribe();
  for (let index = 0; index < 100; index++) hook.startMonitoring(target);
  await tick(100);
  expect(getStats).toHaveBeenCalledTimes(1);
  pending.resolve(report());
  await flush();
  expect(stateWrites).toBe(0);
  await tick();
  expect(getStats).toHaveBeenCalledTimes(2);
  expect(state.producer?.bytesSent).toBe(100);
});

test('remounting with the same object does not overlap its pending request', async () => {
  const pending = deferred<RTCStatsReport>();
  const getStats = mock(() => pending.promise);
  const target = transport(getStats);
  const oldHook = useTransportStats();
  oldHook.subscribe();
  oldHook.startMonitoring(target);
  for (const cleanup of cleanups) cleanup();
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(target);
  await tick(100);
  expect(getStats).toHaveBeenCalledTimes(1);
  pending.resolve(report());
  await flush();
  expect(stateWrites).toBe(0);
  await tick();
  expect(getStats).toHaveBeenCalledTimes(2);
  expect(stateWrites).toBe(1);
});

test('late transport rejection cannot clear a replacement transport', async () => {
  const pending = deferred<RTCStatsReport>();
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(transport(() => pending.promise));
  const replacement = mock(async () => report(500));
  hook.startMonitoring(transport(replacement));
  await flush();
  pending.reject(new Error('closed old transport'));
  await flush();
  await tick();
  expect(replacement).toHaveBeenCalledTimes(2);
  expect(state.producer?.bytesSent).toBe(500);
});

test('removing a screen producer discards its late stats and bitrate baseline', async () => {
  const pending = deferred<RTCStatsReport>();
  const hook = useTransportStats();
  hook.subscribe();
  hook.setScreenShareProducer(screenProducer(() => pending.promise));
  hook.startMonitoring(transport(async () => report()));
  await flush();
  hook.setScreenShareProducer(null);
  const writes = stateWrites;
  pending.resolve(report(900));
  await flush();
  expect(state.screenShare).toBeNull();
  expect(stateWrites).toBe(writes);
  hook.setScreenShareProducer(screenProducer(async () => report(1000)));
  await tick();
  expect(state.screenShare?.bytesSent).toBe(1000);
  expect(state.screenShare?.bitrate).toBe(0);
});

test('reset invalidates pending results without allowing overlapping requests', async () => {
  const pending = deferred<RTCStatsReport>();
  const getStats = mock(() => pending.promise);
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(transport(getStats));
  hook.resetStats();
  await tick(100);
  expect(getStats).toHaveBeenCalledTimes(1);
  pending.resolve(report(900));
  await flush();
  expect(state.producer).toBeNull();
  expect(stateWrites).toBe(1);
  await tick();
  expect(getStats).toHaveBeenCalledTimes(2);
  expect(state.currentBitrateSent).toBe(0);
});

test('a rejected screen stats request releases the collection for subsequent ticks', async () => {
  const hook = useTransportStats();
  hook.subscribe();
  hook.setScreenShareProducer(
    screenProducer(async () => {
      throw new Error('closed');
    })
  );
  const getStats = mock(async () => report());
  hook.startMonitoring(transport(getStats));
  await flush();
  await tick();
  expect(getStats).toHaveBeenCalledTimes(2);
  expect(stateWrites).toBe(2);
  expect(state.screenShare).toBeNull();
});

test('collectors sharing a downstream target cannot overlap its native request', async () => {
  const producerPending = deferred<RTCStatsReport>();
  const consumerPending = deferred<RTCStatsReport>();
  const getStats = mock(() => consumerPending.promise);
  const sharedConsumer = transport(getStats);
  const first = useTransportStats();
  first.subscribe();
  first.startMonitoring(
    transport(() => producerPending.promise),
    sharedConsumer
  );
  const second = useTransportStats();
  second.subscribe();
  second.startMonitoring(
    transport(() => producerPending.promise),
    sharedConsumer
  );
  producerPending.resolve(report());
  await flush();
  expect(getStats).toHaveBeenCalledTimes(1);
  await tick(100);
  expect(getStats).toHaveBeenCalledTimes(1);
});

test('100 polling ticks do not overlap a never-settling transport request', async () => {
  const pending = deferred<RTCStatsReport>();
  const getStats = mock(() => pending.promise);
  const hook = useTransportStats();
  hook.subscribe();
  hook.startMonitoring(transport(getStats));
  await tick(100);
  expect(getStats).toHaveBeenCalledTimes(1);
  expect(stateWrites).toBe(0);
});
