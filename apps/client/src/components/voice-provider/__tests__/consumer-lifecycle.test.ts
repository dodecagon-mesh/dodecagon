import { StreamKind } from '@dodecagon/shared';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { Device } from 'mediasoup-client/types';
import { EventEmitter } from 'node:events';
import * as React from 'react';
import { Transport } from '../../../../../../node_modules/mediasoup-client/lib/Transport.js';

// Exercise the actual hook and mediasoup Transport/Consumer; only React's
// scheduler, RPC and the unavailable native WebRTC handler are substituted.
const effects: (() => void | (() => void))[] = [];
const refs: { current: unknown }[] = [];
mock.module('react', () => ({
  ...React,
  useRef: <T>(current: T) => {
    const ref = { current };
    refs.push(ref);
    return ref;
  },
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  }
}));
mock.module('@/helpers/browser-logger', () => ({
  logVoice: () => {},
  logVoiceWarn: () => {},
  logVoiceError: () => {}
}));
let nextId = 0;
const rtpParameters = {
  codecs: [
    { mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2 }
  ],
  encodings: [{ ssrc: 1234 }]
};
const response = (kind = StreamKind.AUDIO) => ({
  producerId: `p${++nextId}`,
  consumerId: `c${nextId}`,
  consumerKind: kind,
  consumerRtpParameters: rtpParameters,
  consumerType: 'simple',
  qualityLayers: []
});
const consumeRpc = mock(async ({ kind }: { kind: StreamKind }) =>
  response(kind)
);
const params = { id: 'transport', iceCandidates: [] };
const pauseRpc = mock(async () => {});
const resumeRpc = mock(async () => {});
const produceRpc = mock(async (): Promise<string> => crypto.randomUUID());
const closeProducerRpc = mock(
  async (_input: { kind: StreamKind; producerId: string }) => {}
);
const createSendRpc = mock(async () => params);
const createRecvRpc = mock(async () => params);
const subscriptions = new Map<string, (data: unknown) => void>();
const subscription = (name: string) => ({
  subscribe: (
    _input: unknown,
    handlers: { onData: (data: unknown) => void }
  ) => {
    subscriptions.set(name, handlers.onData);
    return { unsubscribe: () => subscriptions.delete(name) };
  }
});
mock.module('@/lib/trpc', () => ({
  getTRPCClient: () => ({
    voice: {
      consume: { mutate: consumeRpc },
      produce: { mutate: produceRpc },
      closeProducer: { mutate: closeProducerRpc },
      pauseConsumer: { mutate: pauseRpc },
      resumeConsumer: { mutate: resumeRpc },
      createProducerTransport: { mutate: createSendRpc },
      createConsumerTransport: { mutate: createRecvRpc },
      onNewProducer: subscription('new'),
      onProducerClosed: subscription('closed'),
      onScreenConsumerStarted: subscription('screen-consumer'),
      onLeave: subscription('leave'),
      onRemoveExternalStream: subscription('external')
    }
  })
}));
mock.module('@/features/server/channels/hooks', () => ({
  useCurrentVoiceChannelId: () => 7
}));
mock.module('@/features/server/users/hooks', () => ({ useOwnUserId: () => 1 }));
const { useTransports } = await import('../hooks/use-transports');
const { useVoiceEvents } = await import('../hooks/use-voice-events');

class Track extends EventTarget {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
}
class Stream {
  addTrack() {}
}
class Handler extends EventEmitter {
  stopped: string[] = [];
  receiveGate?: Promise<void>;
  pausedSending = new Set<string>();
  async pauseSending(id: string) {
    this.pausedSending.add(id);
  }
  async resumeSending(id: string) {
    this.pausedSending.delete(id);
  }
  close() {}
  async send() {
    return { localId: 'send', rtpParameters: structuredClone(rtpParameters) };
  }
  async stopSending(id: string) {
    this.stopped.push(id);
  }
  async receive(options: { trackId: string }[]) {
    if (this.receiveGate) await this.receiveGate;
    return options.map(({ trackId }) => ({
      localId: trackId,
      track: new Track()
    }));
  }
  async stopReceiving(ids: string[]) {
    this.stopped.push(...ids);
  }
}
const makeTransport = (direction: 'send' | 'recv' = 'recv') => {
  const handler = new Handler();
  const transport = new Transport({
    direction,
    id: `t${++nextId}`,
    iceParameters: {},
    iceCandidates: [],
    dtlsParameters: {},
    handlerFactory: { factory: () => handler },
    recvRtpCapabilities: {
      codecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          preferredPayloadType: 111,
          clockRate: 48000,
          channels: 2
        }
      ]
    },
    canProduceByKind: { audio: true, video: true }
  } as unknown as ConstructorParameters<typeof Transport>[0]);
  transport.on('connect', (_params, callback) => callback());
  return { transport, handler };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const callbacks = () => ({
  voiceOnlyMode: false,
  canConsumeScreen: () => true,
  addRemoteUserStream: mock(() => {}),
  removeRemoteUserStream: mock(() => {}),
  addExternalStreamTrack: mock(() => {}),
  removeExternalStreamTrack: mock(() => {}),
  setRemoteConsumerType: mock(() => {}),
  setRemoteStreamQualityLayers: mock(() => {}),
  clearRemoteConsumerMetadata: mock(() => {})
});
let hook: ReturnType<typeof useTransports>;
let handler: Handler;
beforeEach(() => {
  effects.length = 0;
  refs.length = 0;
  subscriptions.clear();
  consumeRpc.mockImplementation(async ({ kind }) => response(kind));
  pauseRpc.mockReset();
  pauseRpc.mockImplementation(async () => {});
  resumeRpc.mockReset();
  resumeRpc.mockImplementation(async () => {});
  createSendRpc.mockImplementation(async () => params);
  produceRpc.mockReset();
  produceRpc.mockImplementation(async () => crypto.randomUUID());
  closeProducerRpc.mockReset();
  closeProducerRpc.mockImplementation(async () => {});
  createRecvRpc.mockImplementation(async () => params);
  globalThis.MediaStream = Stream as unknown as typeof MediaStream;
  hook = useTransports(callbacks());
  const created = makeTransport();
  hook.consumerTransport.current = created.transport;
  handler = created.handler;
});
const originalMediaStream = globalThis.MediaStream;
afterEach(() => {
  hook.cleanupTransports();
  globalThis.MediaStream = originalMediaStream;
});

test('relay standby deactivates RTP without disabling or stopping the shared native capture', async () => {
  const send = makeTransport('send');
  await hook.createProducerTransport({
    createSendTransport: () => send.transport
  } as unknown as Device);
  const track = new Track();
  const publication = await send.transport.produce({
    track: track as unknown as MediaStreamTrack,
    stopTracks: false,
    zeroRtpOnPause: true,
    disableTrackOnPause: false,
    appData: { kind: StreamKind.AUDIO }
  });
  publication.pause();
  await flush();
  expect(send.handler.pausedSending.has('send')).toBe(true);
  expect(track.enabled).toBe(true);
  expect(track.readyState).toBe('live');
  publication.resume();
  await flush();
  expect(send.handler.pausedSending.has('send')).toBe(false);
  expect(track.enabled).toBe(true);
  publication.close();
  expect(track.readyState).toBe('live');
});

for (const cancellation of ['close', 'replacement', 'session'] as const) {
  test(`real AwaitQueue cancellation ${cancellation} cannot register a late native Producer`, async () => {
    const pending = deferred<string>();
    produceRpc.mockImplementationOnce(() => pending.promise);
    const old = makeTransport('send');
    await hook.createProducerTransport({
      createSendTransport: () => old.transport
    } as unknown as Device);
    const registered = mock(() => {});
    old.transport.observer.on('newproducer', registered);
    const track = new Track();
    const publicResult = old.transport
      .produce({
        track: track as unknown as MediaStreamTrack,
        appData: { kind: StreamKind.AUDIO }
      })
      .catch((error: Error) => error);
    await flush();
    expect(produceRpc).toHaveBeenCalledTimes(1);
    if (cancellation === 'session') {
      hook.sessionGenerationRef.current++;
    } else {
      if (cancellation === 'close') old.transport.close();
      else hook.cleanupTransports();
      // REAL Transport.close stops AwaitQueue immediately, not the running RPC.
      const error = await publicResult;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('AwaitQueueStoppedError');
      expect(track.readyState).toBe('ended');
    }
    const replacement = makeTransport('send');
    let replacementProducer;
    if (cancellation === 'replacement') {
      await hook.createProducerTransport({
        createSendTransport: () => replacement.transport
      } as unknown as Device);
      replacementProducer = await replacement.transport.produce({
        track: new Track() as unknown as MediaStreamTrack,
        appData: { kind: StreamKind.AUDIO }
      });
    }
    const staleId = crypto.randomUUID();
    pending.resolve(staleId);
    await flush();
    expect(registered).not.toHaveBeenCalled();
    expect(
      (old.transport as unknown as { _producers: Map<string, unknown> })
        ._producers.size
    ).toBe(0);
    expect(closeProducerRpc).toHaveBeenCalledWith({
      kind: StreamKind.AUDIO,
      producerId: staleId
    });
    expect(old.handler.stopped).toContain('send');
    if (cancellation === 'session')
      expect(await publicResult).toBeInstanceOf(Error);
    if (replacementProducer) {
      expect(replacementProducer.closed).toBe(false);
      expect(replacement.transport.closed).toBe(false);
      expect(hook.producerTransport.current).toBe(replacement.transport);
    }
  });
}

for (const cleanup of ['pending', 'reject'] as const) {
  test(`stale native task rejects even when exact cleanup is ${cleanup}`, async () => {
    const pending = deferred<string>();
    const cleanupGate = deferred<void>();
    produceRpc.mockImplementationOnce(() => pending.promise);
    closeProducerRpc.mockImplementationOnce(() => {
      if (cleanup === 'reject')
        return Promise.reject(new Error('cleanup unavailable'));
      return cleanupGate.promise;
    });
    const old = makeTransport('send');
    await hook.createProducerTransport({
      createSendTransport: () => old.transport
    } as unknown as Device);
    const publicResult = old.transport
      .produce({
        track: new Track() as unknown as MediaStreamTrack,
        appData: { kind: StreamKind.AUDIO }
      })
      .catch((error: Error) => error);
    await flush();
    hook.sessionGenerationRef.current++;
    pending.resolve(crypto.randomUUID());
    await flush();
    expect(old.handler.stopped).toContain('send');
    expect(await publicResult).toBeInstanceOf(Error);
    expect(
      (old.transport as unknown as { _producers: Map<string, unknown> })
        ._producers.size
    ).toBe(0);
    cleanupGate.resolve();
    await flush();
  });
}

test('unique-user churn leaves no per-consumer map entries in a live channel', async () => {
  for (let remoteId = 1; remoteId <= 1000; remoteId++) {
    await hook.consume(remoteId, StreamKind.AUDIO, {});
    hook.closeConsumers(remoteId, [
      StreamKind.AUDIO,
      StreamKind.VIDEO,
      StreamKind.SCREEN,
      StreamKind.SCREEN_AUDIO
    ]);
  }
  await flush();
  expect(hook.consumerTransport.current?.closed).toBe(false);
  expect(Object.keys(hook.consumers.current)).toHaveLength(0);
  // Capture the real hook refs, without exposing private maps in production.
  const maps = refs
    .map((ref) => ref.current)
    .filter((value) => value instanceof Map);
  expect(maps.length).toBeGreaterThan(0);
  expect(maps.map((map) => map.size)).toEqual(maps.map(() => 0));
});

test('closing a producer releases its real Consumer and metadata', async () => {
  await hook.consume(42, StreamKind.AUDIO, {});
  const consumer = hook.getConsumer(42, StreamKind.AUDIO)!;
  hook.closeConsumer(42, StreamKind.AUDIO);
  await flush();
  expect(consumer.closed).toBe(true);
  expect(handler.stopped).toContain(consumer.localId);
  expect(hook.getConsumer(42, StreamKind.AUDIO)).toBeUndefined();
  expect(hook.consumers.current[42]).toBeUndefined();
  expect(hook.getConsumerCodec(42, StreamKind.AUDIO)).toBeUndefined();
});

test('closing a screen producer invalidates consumption waiting for RPC', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  consumeRpc.mockImplementationOnce(() => pending.promise);
  const operation = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  await flush();
  hook.closeConsumer(42, StreamKind.SCREEN_AUDIO);
  pending.resolve(response(StreamKind.SCREEN_AUDIO));
  await operation;
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBeUndefined();
  expect(
    (
      hook.consumerTransport.current as unknown as {
        _consumers: Map<string, unknown>;
      }
    )._consumers.size
  ).toBe(0);
});

test('remote leave closes only remote kinds, not colliding external stream IDs', async () => {
  await hook.consume(42, StreamKind.AUDIO, {});
  await hook.consume(42, StreamKind.EXTERNAL_AUDIO, {});
  const remote = hook.getConsumer(42, StreamKind.AUDIO)!;
  const external = hook.getConsumer(42, StreamKind.EXTERNAL_AUDIO)!;
  hook.closeConsumers(42, [
    StreamKind.AUDIO,
    StreamKind.VIDEO,
    StreamKind.SCREEN,
    StreamKind.SCREEN_AUDIO
  ]);
  expect(remote.closed).toBe(true);
  expect(external.closed).toBe(false);
  hook.closeConsumers(42, [
    StreamKind.EXTERNAL_AUDIO,
    StreamKind.EXTERNAL_VIDEO
  ]);
  expect(external.closed).toBe(true);
  expect(hook.consumers.current[42]).toBeUndefined();
});

for (const direction of ['send', 'recv'] as const) {
  test(`${direction} transport RPC completion after cleanup rejects without resurrection`, async () => {
    const pending = deferred<typeof params>();
    (direction === 'send'
      ? createSendRpc
      : createRecvRpc
    ).mockImplementationOnce(() => pending.promise);
    const create = mock(() => makeTransport(direction).transport);
    const device = {
      createSendTransport: create,
      createRecvTransport: create
    } as unknown as Device;
    const operation =
      direction === 'send'
        ? hook.createProducerTransport(device)
        : hook.createConsumerTransport(device);
    // Attach the rejection handler before resolving to avoid an unhandled rejection.
    const settled = operation.then(
      () => 'resolved',
      () => 'rejected'
    );
    hook.cleanupTransports();
    pending.resolve(params);
    expect(await settled).toBe('rejected');
    expect(create).not.toHaveBeenCalled();
    expect(hook.producerTransport.current).toBeUndefined();
    expect(hook.consumerTransport.current).toBeUndefined();
  });
}

test('replacing a Consumer preserves the replacement identity and metadata', async () => {
  await hook.consume(42, StreamKind.AUDIO, {});
  const old = hook.getConsumer(42, StreamKind.AUDIO)!;
  await hook.consume(42, StreamKind.AUDIO, {});
  const replacement = hook.getConsumer(42, StreamKind.AUDIO);
  expect(old.closed).toBe(true);
  expect(replacement).toBeDefined();
  expect(replacement?.closed).toBe(false);
  expect(hook.getConsumerCodec(42, StreamKind.AUDIO)).toBe('audio/opus');
});

for (const direction of ['send', 'recv'] as const) {
  test(`${direction} transport created during reentrant cleanup is closed`, async () => {
    const transport = makeTransport(direction).transport;
    const create = () => {
      hook.cleanupTransports();
      return transport;
    };
    const device = {
      createSendTransport: create,
      createRecvTransport: create
    } as unknown as Device;
    const operation =
      direction === 'send'
        ? hook.createProducerTransport(device)
        : hook.createConsumerTransport(device);
    await expect(operation).rejects.toThrow('Voice session ended');
    expect(transport.closed).toBe(true);
    expect(hook.producerTransport.current).toBeUndefined();
    expect(hook.consumerTransport.current).toBeUndefined();
  });
}

test('metadata is indexed and cleared by the actual consumer kind', async () => {
  consumeRpc.mockImplementationOnce(async () =>
    response(StreamKind.SCREEN_AUDIO)
  );
  await hook.consume(42, StreamKind.SCREEN, {});
  const consumer = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  expect(hook.getConsumerCodec(42, StreamKind.SCREEN_AUDIO)).toBe('audio/opus');
  consumer.track.dispatchEvent(new Event('ended'));
  expect(hook.getConsumerCodec(42, StreamKind.SCREEN_AUDIO)).toBeUndefined();
  expect(hook.getConsumerCodec(42, StreamKind.SCREEN)).toBeUndefined();
});

for (const direction of ['send', 'recv'] as const) {
  test(`${direction} stale transport events cannot close or clear the replacement`, async () => {
    const old = makeTransport(direction).transport;
    const replacement = makeTransport(direction).transport;
    let transport = old;
    const device = {
      createSendTransport: () => transport,
      createRecvTransport: () => transport
    } as unknown as Device;
    const create =
      direction === 'send'
        ? hook.createProducerTransport
        : hook.createConsumerTransport;
    await create(device);
    transport = replacement;
    await create(device);
    old.emit('connectionstatechange', 'failed');
    old.emit('connectionstatechange', 'closed');
    expect(replacement.closed).toBe(false);
    expect(
      (direction === 'send' ? hook.producerTransport : hook.consumerTransport)
        .current
    ).toBe(replacement);
    old.close();
  });
}

test('external removal closes a Consumer created after an in-flight native receive', async () => {
  const pending = deferred<void>();
  handler.receiveGate = pending.promise;
  const operation = hook.consume(42, StreamKind.EXTERNAL_AUDIO, {});
  await flush();
  hook.closeConsumers(42, [
    StreamKind.EXTERNAL_AUDIO,
    StreamKind.EXTERNAL_VIDEO
  ]);
  pending.resolve();
  await operation;
  await flush();
  expect(handler.stopped).toHaveLength(1);
  expect(hook.getConsumer(42, StreamKind.EXTERNAL_AUDIO)).toBeUndefined();
  expect(
    (
      hook.consumerTransport.current as unknown as {
        _consumers: Map<string, unknown>;
      }
    )._consumers.size
  ).toBe(0);
});

test('a late old consume cannot overwrite a restarted screen producer', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  consumeRpc.mockImplementationOnce(() => pending.promise);
  const oldOperation = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  await flush();
  hook.closeConsumer(42, StreamKind.SCREEN_AUDIO);
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const replacement = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  pending.resolve(response(StreamKind.SCREEN_AUDIO));
  await oldOperation;
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(replacement);
  expect(replacement.closed).toBe(false);
});

test('a screen waiter cannot revive a closed producer after the old tail settles', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  consumeRpc.mockImplementationOnce(() => pending.promise);
  const operation = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const waiter = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  await flush();
  hook.closeConsumer(42, StreamKind.SCREEN_AUDIO);
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const replacement = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  pending.resolve(response(StreamKind.SCREEN_AUDIO));
  await Promise.all([operation, waiter]);
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(replacement);
  expect(replacement.closed).toBe(false);
  hook.closeConsumer(42, StreamKind.SCREEN_AUDIO);
  expect(
    refs
      .filter((ref) => ref.current instanceof Map)
      .map((ref) => (ref.current as Map<string, unknown>).size)
  ).toEqual([0, 0, 0, 0]);
});

test('queued screen pause keeps the client consumer live while the server holds standby', async () => {
  let viewing = true;
  hook.cleanupTransports();
  refs.length = 0;
  const lifecycle = callbacks();
  hook = useTransports({ ...lifecycle, canConsumeScreen: () => viewing });
  hook.consumerTransport.current = makeTransport().transport;
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const consumer = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  const relayStream = hook.consumerStreams.current.get(
    `42-${StreamKind.SCREEN_AUDIO}`
  );
  expect(relayStream).toBeDefined();
  lifecycle.addRemoteUserStream.mockClear();
  consumer.pause();
  const pending = deferred<void>();
  resumeRpc.mockImplementationOnce(() => pending.promise);
  const operation = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  await flush();
  viewing = false;
  const pause = hook.pauseDemoConsumers(42);
  pending.resolve();
  await Promise.all([operation, pause]);
  expect(consumer.closed).toBe(false);
  expect(consumer.paused).toBe(false);
  expect(pauseRpc).toHaveBeenCalled();
  viewing = true;
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(consumer);
  expect(consumer.paused).toBe(false);
  expect(lifecycle.addRemoteUserStream).toHaveBeenCalledWith(
    42,
    relayStream,
    StreamKind.SCREEN_AUDIO
  );
  hook.closeConsumer(42, StreamKind.SCREEN_AUDIO);
  expect(
    refs
      .filter((ref) => ref.current instanceof Map)
      .every((ref) => (ref.current as Map<string, unknown>).size === 0)
  ).toBe(true);
});

test('rewatching during a queued screen pause resumes the same server consumer', async () => {
  let viewing = true;
  hook.cleanupTransports();
  refs.length = 0;
  const lifecycle = callbacks();
  hook = useTransports({ ...lifecycle, canConsumeScreen: () => viewing });
  hook.consumerTransport.current = makeTransport().transport;
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const consumer = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  const relayStream = hook.consumerStreams.current.get(
    `42-${StreamKind.SCREEN_AUDIO}`
  );
  expect(relayStream).toBeDefined();
  lifecycle.addRemoteUserStream.mockClear();
  const pending = deferred<void>();
  pauseRpc.mockImplementationOnce(() => pending.promise);
  viewing = false;
  const pause = hook.pauseDemoConsumers(42);
  await flush();
  expect(pauseRpc).toHaveBeenCalledWith({
    remoteId: 42,
    kind: StreamKind.SCREEN_AUDIO
  });
  viewing = true;
  const rewatch = hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  pending.resolve();
  await Promise.all([pause, rewatch]);
  expect(resumeRpc).toHaveBeenCalledWith({
    remoteId: 42,
    kind: StreamKind.SCREEN_AUDIO,
    consumerId: consumer.id,
    requestDirect: true
  });
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(consumer);
  expect(lifecycle.addRemoteUserStream).toHaveBeenCalledWith(
    42,
    relayStream,
    StreamKind.SCREEN_AUDIO
  );
});

test('rewatching before a standby pause starts resumes and republishes the relay', async () => {
  let viewing = true;
  hook.cleanupTransports();
  refs.length = 0;
  const lifecycle = callbacks();
  hook = useTransports({ ...lifecycle, canConsumeScreen: () => viewing });
  hook.consumerTransport.current = makeTransport().transport;
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  const consumer = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
  const relayStream = hook.consumerStreams.current.get(
    `42-${StreamKind.SCREEN_AUDIO}`
  );
  expect(relayStream).toBeDefined();
  lifecycle.addRemoteUserStream.mockClear();
  viewing = false;
  hook.markDemoConsumersPaused(42);
  viewing = true;
  await hook.pauseDemoConsumers(42);
  await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
  expect(pauseRpc).not.toHaveBeenCalled();
  expect(resumeRpc).toHaveBeenCalledWith({
    remoteId: 42,
    kind: StreamKind.SCREEN_AUDIO,
    consumerId: consumer.id,
    requestDirect: true
  });
  expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(consumer);
  expect(lifecycle.addRemoteUserStream).toHaveBeenCalledWith(
    42,
    relayStream,
    StreamKind.SCREEN_AUDIO
  );
});

test('voice subscriptions release remote and external resources through context callbacks', async () => {
  const clearViewedDemo = mock(() => {});
  const onScreenViewerStarted = mock(() => {});
  useVoiceEvents({
    consumeRef: hook.consumeRef,
    isViewingDemo: () => true,
    // These are the resource-owning callbacks exposed by VoiceProvider.
    removeRemoteUserStream: hook.closeConsumer,
    closeRemoteUserProducer: hook.closeConsumer,
    removeExternalStreamTrack: hook.closeConsumer,
    clearRemoteUserStreamsForUser: (id) =>
      hook.closeConsumers(id, [
        StreamKind.AUDIO,
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ]),
    removeExternalStream: (id) =>
      hook.closeConsumers(id, [
        StreamKind.EXTERNAL_AUDIO,
        StreamKind.EXTERNAL_VIDEO
      ]),
    clearViewedDemo,
    onScreenViewerStarted,
    rtpCapabilitiesRef: { current: {} },
    isVoiceSessionActive: true
  });
  const cleanup = effects.at(-1)!();
  try {
    subscriptions.get('screen-consumer')!({ channelId: 99, peerId: 42 });
    expect(onScreenViewerStarted).not.toHaveBeenCalled();
    subscriptions.get('screen-consumer')!({ channelId: 7, peerId: 42 });
    expect(onScreenViewerStarted).toHaveBeenCalledWith(42);
    await hook.consume(42, StreamKind.SCREEN, {});
    await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
    const staleScreen = hook.getConsumer(42, StreamKind.SCREEN)!;
    const screen = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
    consumeRpc.mockClear();
    subscriptions.get('new')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN,
      replaceConsumerId: staleScreen.id
    });
    await flush();
    expect(staleScreen.closed).toBe(true);
    expect(hook.getConsumer(42, StreamKind.SCREEN)).not.toBe(staleScreen);
    expect(hook.getConsumer(42, StreamKind.SCREEN_AUDIO)).toBe(screen);
    expect(consumeRpc).toHaveBeenCalledTimes(1);
    subscriptions.get('closed')!({
      channelId: 99,
      remoteId: 42,
      kind: StreamKind.SCREEN_AUDIO
    });
    expect(screen.closed).toBe(false);
    subscriptions.get('closed')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN_AUDIO
    });
    expect(screen.closed).toBe(true);
    expect(clearViewedDemo).not.toHaveBeenCalled();
    await hook.consume(42, StreamKind.AUDIO, {});
    await hook.consume(42, StreamKind.EXTERNAL_AUDIO, {});
    const remote = hook.getConsumer(42, StreamKind.AUDIO)!;
    const external = hook.getConsumer(42, StreamKind.EXTERNAL_AUDIO)!;
    subscriptions.get('leave')!({ channelId: 7, userId: 42 });
    expect(remote.closed).toBe(true);
    expect(external.closed).toBe(false);
    subscriptions.get('external')!({ channelId: 7, streamId: 42 });
    expect(external.closed).toBe(true);
    await flush();
    expect(hook.consumers.current[42]).toBeUndefined();
    expect(
      (
        hook.consumerTransport.current as unknown as {
          _consumers: Map<string, unknown>;
        }
      )._consumers.size
    ).toBe(0);
  } finally {
    if (cleanup) cleanup();
  }
});

test('trackended closes the real Consumer and releases the transport receiver', async () => {
  await hook.consume(42, StreamKind.AUDIO, {});
  const consumer = hook.getConsumer(42, StreamKind.AUDIO)!;
  expect(consumer).toBeDefined();
  consumer.track.dispatchEvent(new Event('ended'));
  await flush();
  expect(consumer.closed).toBe(true);
  expect(handler.stopped).toContain(consumer.localId);
  expect(
    (
      hook.consumerTransport.current as unknown as {
        _consumers: Map<string, unknown>;
      }
    )._consumers.size
  ).toBe(0);
  expect(hook.getConsumer(42, StreamKind.AUDIO)).toBeUndefined();
  expect(hook.getConsumerCodec(42, StreamKind.AUDIO)).toBeUndefined();
});

test('closing and restarting a watched presentation preserves consent and consumes both new tracks', async () => {
  let watching = true;
  const clearViewedDemo = mock((userId: number) => {
    expect(userId).toBe(42);
    watching = false;
  });
  useVoiceEvents({
    consumeRef: hook.consumeRef,
    isViewingDemo: () => watching,
    removeRemoteUserStream: hook.closeConsumer,
    closeRemoteUserProducer: hook.closeConsumer,
    removeExternalStreamTrack: hook.closeConsumer,
    clearRemoteUserStreamsForUser: (id) =>
      hook.closeConsumers(id, [
        StreamKind.AUDIO,
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ]),
    removeExternalStream: (id) =>
      hook.closeConsumers(id, [
        StreamKind.EXTERNAL_AUDIO,
        StreamKind.EXTERNAL_VIDEO
      ]),
    clearViewedDemo,
    rtpCapabilitiesRef: { current: {} },
    isVoiceSessionActive: true
  });
  const cleanup = effects.at(-1)!();
  try {
    await hook.consume(42, StreamKind.SCREEN, {});
    await hook.consume(42, StreamKind.SCREEN_AUDIO, {});
    const oldScreen = hook.getConsumer(42, StreamKind.SCREEN)!;
    const oldAudio = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;

    subscriptions.get('closed')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN,
      producerId: oldScreen.producerId
    });
    subscriptions.get('closed')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN_AUDIO,
      producerId: oldAudio.producerId
    });

    expect(watching).toBe(true);
    expect(clearViewedDemo).not.toHaveBeenCalled();
    expect(oldScreen.closed).toBe(true);
    expect(oldAudio.closed).toBe(true);

    subscriptions.get('new')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN
    });
    subscriptions.get('new')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN_AUDIO
    });
    await flush();

    const restartedScreen = hook.getConsumer(42, StreamKind.SCREEN)!;
    const restartedAudio = hook.getConsumer(42, StreamKind.SCREEN_AUDIO)!;
    expect(restartedScreen.closed).toBe(false);
    expect(restartedAudio.closed).toBe(false);
    expect(restartedScreen.producerId).not.toBe(oldScreen.producerId);
    expect(restartedAudio.producerId).not.toBe(oldAudio.producerId);
  } finally {
    if (cleanup) cleanup();
  }
});

test('late closure for an old screen producer cannot close its replacement consumer', async () => {
  let watching = true;
  const clearViewedDemo = mock(() => {
    watching = false;
  });
  await hook.consume(42, StreamKind.SCREEN, {});
  const oldProducerId = hook.getConsumer(42, StreamKind.SCREEN)!.producerId;
  hook.closeConsumer(42, StreamKind.SCREEN);
  await hook.consume(42, StreamKind.SCREEN, {});
  const replacement = hook.getConsumer(42, StreamKind.SCREEN)!;

  useVoiceEvents({
    consumeRef: hook.consumeRef,
    isViewingDemo: () => watching,
    removeRemoteUserStream: hook.closeConsumer,
    closeRemoteUserProducer: hook.closeConsumer,
    removeExternalStreamTrack: hook.closeConsumer,
    clearRemoteUserStreamsForUser: (id) =>
      hook.closeConsumers(id, [
        StreamKind.AUDIO,
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ]),
    removeExternalStream: (id) =>
      hook.closeConsumers(id, [
        StreamKind.EXTERNAL_AUDIO,
        StreamKind.EXTERNAL_VIDEO
      ]),
    clearViewedDemo,
    rtpCapabilitiesRef: { current: {} },
    isVoiceSessionActive: true
  });
  const cleanup = effects.at(-1)!();
  try {
    subscriptions.get('closed')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN,
      producerId: oldProducerId
    });

    expect(replacement.closed).toBe(false);
    expect(hook.getConsumer(42, StreamKind.SCREEN)).toBe(replacement);
    expect(watching).toBe(true);
    expect(clearViewedDemo).not.toHaveBeenCalled();
  } finally {
    if (cleanup) cleanup();
  }
});

test('late old producer closure during replacement receive cannot cancel the new native consumer', async () => {
  let watching = true;
  const clearViewedDemo = mock(() => {
    watching = false;
  });
  await hook.consume(42, StreamKind.SCREEN, {});
  const oldProducerId = hook.getConsumer(42, StreamKind.SCREEN)!.producerId;
  hook.closeConsumer(42, StreamKind.SCREEN);
  const pendingReceive = deferred<void>();
  handler.receiveGate = pendingReceive.promise;
  consumeRpc.mockImplementationOnce(async () => ({
    ...response(StreamKind.SCREEN),
    producerId: 'replacement-screen-producer'
  }));

  useVoiceEvents({
    consumeRef: hook.consumeRef,
    isViewingDemo: () => watching,
    removeRemoteUserStream: hook.closeConsumer,
    closeRemoteUserProducer: hook.closeConsumer,
    removeExternalStreamTrack: hook.closeConsumer,
    clearRemoteUserStreamsForUser: (id) =>
      hook.closeConsumers(id, [
        StreamKind.AUDIO,
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ]),
    removeExternalStream: (id) =>
      hook.closeConsumers(id, [
        StreamKind.EXTERNAL_AUDIO,
        StreamKind.EXTERNAL_VIDEO
      ]),
    clearViewedDemo,
    rtpCapabilitiesRef: { current: {} },
    isVoiceSessionActive: true
  });
  const cleanup = effects.at(-1)!();
  try {
    const replacementOperation = hook.consume(42, StreamKind.SCREEN, {});
    await flush();
    subscriptions.get('closed')!({
      channelId: 7,
      remoteId: 42,
      kind: StreamKind.SCREEN,
      producerId: oldProducerId
    });
    pendingReceive.resolve();
    await replacementOperation;

    const replacement = hook.getConsumer(42, StreamKind.SCREEN);
    expect(watching).toBe(true);
    expect(clearViewedDemo).not.toHaveBeenCalled();
    expect(replacement?.producerId).toBe('replacement-screen-producer');
    expect(replacement?.closed).toBe(false);
  } finally {
    if (cleanup) cleanup();
  }
});

test('a relay closed during native handoff is never resumed after attachment', async () => {
  hook.cleanupTransports();
  hook = useTransports({
    ...callbacks(),
    addRemoteUserStream: () => hook.closeConsumer(42, StreamKind.VIDEO)
  });
  const created = makeTransport();
  hook.consumerTransport.current = created.transport;
  await hook.consume(42, StreamKind.VIDEO, {});
  await flush();
  expect(hook.getConsumer(42, StreamKind.VIDEO)).toBeUndefined();
  expect(created.handler.stopped.length).toBe(1);
  expect(resumeRpc).not.toHaveBeenCalled();
});
