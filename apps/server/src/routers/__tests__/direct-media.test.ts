import {
  ChannelPermission,
  Permission,
  ServerEvents,
  StreamKind,
  type TDirectMediaEvent,
  type TRelayDemandEvent
} from '@dodecagon/shared';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { parse } from 'ini';
import { getCaller, initTest, type TTestCaller } from '../../__tests__/helpers';
import { tdb, testLogs } from '../../__tests__/setup';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { config, defaultConfig, envOverridesMap, zConfig } from '../../config';
import { channelRolePermissions, rolePermissions } from '../../db/schema';
import { applyEnvOverrides } from '../../helpers/apply-env-overrides';
import { VoiceRuntime } from '../../runtimes/voice';
import { deepMerge } from '../../utils/deep-merge';
import { pubsub } from '../../utils/pubsub';

test('keeps established screen direct sessions when a third participant joins', async () => {
  const runtime = new VoiceRuntime(2);
  runtime.addUser(
    1,
    { micMuted: false, soundMuted: false },
    getTestVoiceConnection(1)
  );
  runtime.addUser(
    2,
    { micMuted: false, soundMuted: false },
    getTestVoiceConnection(2)
  );
  const { caller: sender } = await initTest(1, undefined, {
    currentVoiceChannelId: 2
  });
  const { caller: receiver } = await initTest(2, undefined, {
    currentVoiceChannelId: 2
  });
  const previous = config.webRtc.holepunchMediaEnabled;
  config.webRtc.holepunchMediaEnabled = true;
  const signals: string[] = [];
  const observation = pubsub
    .subscribeFor(1, ServerEvents.DIRECT_MEDIA_SIGNAL)
    .subscribe({ next: (event) => signals.push(event.signal.type) });
  let senderSubscription: { unsubscribe: () => void } | undefined;
  let receiverSubscription: { unsubscribe: () => void } | undefined;
  try {
    senderSubscription = (
      await sender.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).subscribe({ next: () => {} });
    receiverSubscription = (
      await receiver.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).subscribe({ next: () => {} });
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(session?.peerId).toBe(2);
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    expect(signals).toEqual([]);
    expect(runtime.getDirectMediaSession(session!.sessionId, 1)).toBeDefined();
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: session!.sessionId,
        signal: { type: 'offer', sdp: 'v=0\r\n', publicKey: 'a'.repeat(64) }
      })
    ).resolves.toBeUndefined();
  } finally {
    senderSubscription?.unsubscribe();
    receiverSubscription?.unsubscribe();
    observation.unsubscribe();
    config.webRtc.holepunchMediaEnabled = previous;
    await runtime.destroy();
  }
});

const clock = () => {
  const deadlines = new Map<
    NodeJS.Timeout,
    { callback: () => void; delay: number }
  >();
  const setDeadline = Object.assign(
    (...[handler, delay]: Parameters<typeof setTimeout>) => {
      const handle = { unref: () => handle } as unknown as NodeJS.Timeout;
      deadlines.set(handle, {
        callback: () => {
          if (typeof handler === 'function') handler();
        },
        delay: delay ?? 0
      });
      return handle;
    },
    globalThis.setTimeout
  );
  spyOn(globalThis, 'setTimeout').mockImplementation(setDeadline);
  spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
    deadlines.delete(handle as NodeJS.Timeout);
  });
  return {
    advance: (milliseconds: number) => {
      for (const [handle, deadline] of deadlines) {
        if (deadline.delay > milliseconds) continue;
        deadlines.delete(handle);
        deadline.callback();
      }
    }
  };
};
const subscriptions: { unsubscribe: () => void }[] = [];
const runtimes: VoiceRuntime[] = [];
const originalEnabled = config.webRtc.holepunchMediaEnabled;
const originalStun = config.webRtc.directScreenStunUrls;
const offer = {
  type: 'offer',
  sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
  publicKey: 'a'.repeat(64)
} as const;
const answer = {
  type: 'answer',
  sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
  publicKey: 'b'.repeat(64)
} as const;

afterEach(async () => {
  for (const subscription of subscriptions.splice(0))
    subscription.unsubscribe();
  for (const runtime of runtimes.splice(0)) await runtime.destroy();
  config.webRtc.holepunchMediaEnabled = originalEnabled;
  config.webRtc.directScreenStunUrls = originalStun;
});

const pair = async (channelId = 2) => {
  config.webRtc.holepunchMediaEnabled = true;
  const runtime = new VoiceRuntime(channelId);
  runtimes.push(runtime);
  runtime.addUser(
    1,
    { micMuted: false, soundMuted: false },
    getTestVoiceConnection(1)
  );
  runtime.addUser(
    2,
    { micMuted: false, soundMuted: false },
    getTestVoiceConnection(2)
  );
  const { caller: sender } = await initTest(1, undefined, {
    currentVoiceChannelId: channelId
  });
  const { caller: receiver } = await initTest(2, undefined, {
    currentVoiceChannelId: channelId
  });
  return { runtime, sender, receiver };
};

const listen = async (caller: TTestCaller, enabled = true) => {
  const events: TDirectMediaEvent[] = [];
  const subscription = (
    await caller.voice.onDirectMediaSignal({ enabled, transport: 'holepunch' })
  ).subscribe({
    next: (event) => events.push(event)
  });
  subscriptions.push(subscription);
  return { events, subscription };
};

const prepared = async () => {
  const result = await pair();
  const sending = await listen(result.sender);
  const receiving = await listen(result.receiver);
  const session = await result.sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  expect(session).not.toBeNull();
  return { ...result, sending, receiving, session: session! };
};

test('termination always reports relay as available', async () => {
  const { sender, receiving, session } = await prepared();
  await sender.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: { type: 'fallback' }
  });
  expect(receiving.events.at(-1)).toHaveProperty('relayAllowed', true);
});

test('a viewer fallback keeps the presenter sharing through relay', async () => {
  const { runtime, sender, receiver, sending, session } = await prepared();
  await sender.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: offer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: answer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: { type: 'ready' }
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: { type: 'fallback' }
  });
  expect(sending.events.at(-1)).toMatchObject({
    relayAllowed: true,
    senderId: 1,
    fromUserId: 2,
    signal: { type: 'fallback' }
  });
  expect(runtime.getDirectMediaSession(session.sessionId, 1)).toBeUndefined();
  expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
  expect(runtime.getUserState(2).directMediaEnabled).toBe(true);

  await runtime.init();
  const transport = await runtime.createProducerTransport(1);
  await sender.voice.produce({
    transportId: transport.id,
    kind: StreamKind.SCREEN,
    rtpParameters: {
      codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }],
      encodings: [{ ssrc: 7788 }]
    }
  });
  expect(runtime.getRemoteIds(2).remoteScreenIds).toEqual([1]);
});

test('allocates independent microphone, webcam and screen sessions for one opted-in pair', async () => {
  const { sender, receiver, runtime } = await pair();
  await listen(sender);
  await listen(receiver);
  const kinds = [
    StreamKind.AUDIO,
    StreamKind.VIDEO,
    StreamKind.SCREEN
  ] as const;
  const sessions = await Promise.allSettled(
    kinds.map((kind) => sender.voice.startDirectMedia({ kind, peerId: 2 }))
  );
  expect(sessions.map((result) => result.status)).toEqual([
    'fulfilled',
    'fulfilled',
    'fulfilled'
  ]);
  const ids = new Set<string>();
  sessions.forEach((result, index) => {
    if (result.status !== 'fulfilled') throw result.reason;
    expect(result.value?.kind).toBe(kinds[index]);
    expect(result.value?.peerId).toBe(2);
    ids.add(result.value!.sessionId);
    expect(
      runtime.getDirectMediaSession(result.value!.sessionId, 1)
    ).toBeDefined();
  });
  expect(ids.size).toBe(3);
});

test('publishes live direct capability and clears it only for the current subscription', async () => {
  const { sender } = await pair();
  const updates: unknown[] = [];
  const observation = pubsub
    .subscribe(ServerEvents.USER_VOICE_STATE_UPDATE)
    .subscribe({
      next: (event) => updates.push(event)
    });
  subscriptions.push(observation);
  const current = await listen(sender);
  expect(updates).toEqual([
    {
      channelId: 2,
      userId: 1,
      state: expect.objectContaining({ directMediaEnabled: true })
    }
  ]);
  current.subscription.unsubscribe();
  expect(updates).toHaveLength(2);
  expect(updates[1]).toEqual({
    channelId: 2,
    userId: 1,
    state: expect.objectContaining({ directMediaEnabled: false })
  });
});

const revoke = async (permission: Permission) => {
  await tdb
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, 2),
        eq(rolePermissions.permission, permission)
      )
    );
};

test('voice-only mode ends direct media and blocks capability until disabled', async () => {
  const { runtime, sender, receiver, sending, receiving, session } =
    await prepared();
  await receiver.voice.updateState({ voiceOnlyMode: true });
  expect(runtime.hasDirectMediaCapability(2, StreamKind.SCREEN)).toBe(false);
  expect(runtime.getDirectMediaSession(session.sessionId, 1)).toBeUndefined();
  expect(sending.events.map((event) => event.signal.type)).toEqual([
    'fallback'
  ]);
  expect(receiving.events.map((event) => event.signal.type)).toEqual([
    'fallback'
  ]);
  expect(
    await sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
  ).toBeNull();
  const replacement = runtime.registerDirectMediaSubscriber(2, true);
  expect(runtime.hasDirectMediaCapability(2, StreamKind.SCREEN)).toBe(false);
  await receiver.voice.updateState({ voiceOnlyMode: false });
  expect(runtime.hasDirectMediaCapability(2, StreamKind.SCREEN)).toBe(true);
  expect(
    await sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
  ).not.toBeNull();
  replacement.unregister();
});

test.each([
  StreamKind.AUDIO,
  StreamKind.VIDEO,
  StreamKind.SCREEN,
  StreamKind.SCREEN_AUDIO
])(
  'keeps the SFU %s consumer available after the pair enables direct media',
  async (kind) => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await runtime.init();
    const transport = await runtime.getRouter().createDirectTransport();
    try {
      const audio =
        kind === StreamKind.AUDIO || kind === StreamKind.SCREEN_AUDIO;
      const producer = await transport.produce({
        kind: audio ? 'audio' : 'video',
        rtpParameters: {
          codecs: [
            audio
              ? {
                  mimeType: 'audio/opus',
                  payloadType: 111,
                  clockRate: 48000,
                  channels: 2
                }
              : { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
          ],
          encodings: [{ ssrc: 12345 }]
        }
      });
      runtime.addProducer(1, kind, producer);
      await runtime.createConsumerTransport(2);
      const consume = spyOn(runtime.getConsumerTransport(2)!, 'consume');
      await listen(receiver);
      const available = await receiver.voice.getProducers();
      expect([
        ...available.remoteAudioIds,
        ...available.remoteVideoIds,
        ...available.remoteScreenIds,
        ...available.remoteScreenAudioIds
      ]).toContain(1);
      await receiver.voice.consume({
        kind,
        remoteId: 1,
        rtpCapabilities: runtime.getRouter().rtpCapabilities
      });
      expect(consume).toHaveBeenCalled();
    } finally {
      transport.close();
    }
  }
);

test.each([
  StreamKind.AUDIO,
  StreamKind.VIDEO,
  StreamKind.SCREEN,
  StreamKind.SCREEN_AUDIO
])(
  'keeps a late SFU %s consumer when the pair opts into direct media',
  async (kind) => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await runtime.init();
    const transport = await runtime.getRouter().createDirectTransport();
    try {
      const audio =
        kind === StreamKind.AUDIO || kind === StreamKind.SCREEN_AUDIO;
      const producer = await transport.produce({
        kind: audio ? 'audio' : 'video',
        rtpParameters: {
          codecs: [
            audio
              ? {
                  mimeType: 'audio/opus',
                  payloadType: 111,
                  clockRate: 48000,
                  channels: 2
                }
              : { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
          ],
          encodings: [{ ssrc: 12345 }]
        }
      });
      runtime.addProducer(1, kind, producer);
      const consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: runtime.getRouter().rtpCapabilities
      });
      await listen(receiver);
      expect(() => runtime.addConsumer(2, 1, kind, consumer)).not.toThrow();
      expect(consumer.closed).toBe(false);
      expect(runtime.getConsumer(2, 1, kind)).toBe(consumer);
    } finally {
      transport.close();
    }
  }
);

describe('direct screen configuration', () => {
  test.each([StreamKind.SCREEN, StreamKind.SCREEN_AUDIO])(
    'keeps SFU %s production available when both participants enable P2P',
    async (kind) => {
      const { runtime, sender, receiver } = await pair();
      await listen(sender);
      await listen(receiver);
      await runtime.init();
      const params = await runtime.createProducerTransport(1);
      const produce = spyOn(runtime.getProducerTransport(1)!, 'produce');
      const video = kind === StreamKind.SCREEN;
      const producerId = await sender.voice.produce({
        transportId: params.id,
        kind,
        rtpParameters: {
          codecs: [
            video
              ? { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
              : {
                  mimeType: 'audio/opus',
                  payloadType: 111,
                  clockRate: 48000,
                  channels: 2
                }
          ],
          encodings: [{ ssrc: 7788 }]
        }
      });
      expect(produce).toHaveBeenCalled();
      expect(runtime.getProducer(kind, 1)?.id).toBe(producerId);
    }
  );

  test.each([true, false])(
    'permits SFU when only one participant opts in (sender=%s)',
    async (senderEnabled) => {
      const { runtime, sender, receiver } = await pair();
      await listen(sender, senderEnabled);
      await listen(receiver, !senderEnabled);
      expect(
        await sender.voice.startDirectMedia({
          kind: StreamKind.SCREEN,
          peerId: 2
        })
      ).toBeNull();
      await runtime.init();
      const params = await runtime.createProducerTransport(1);
      const producerId = await sender.voice.produce({
        transportId: params.id,
        kind: StreamKind.SCREEN,
        rtpParameters: {
          codecs: [
            { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
          ],
          encodings: [{ ssrc: 5566 }]
        }
      });
      expect(runtime.getProducer(StreamKind.SCREEN, 1)?.id).toBe(producerId);
    }
  );

  test('keeps late SFU production when the second participant opts into P2P', async () => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await runtime.init();
    const transport = await runtime.getRouter().createDirectTransport();
    try {
      const producer = await transport.produce({
        kind: 'video',
        rtpParameters: {
          codecs: [
            { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
          ],
          encodings: [{ ssrc: 8899 }]
        }
      });
      await listen(receiver);
      expect(() =>
        runtime.addProducer(1, StreamKind.SCREEN, producer)
      ).not.toThrow();
      expect(producer.closed).toBe(false);
      expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBe(producer);
    } finally {
      transport.close();
    }
  });

  test('server opt-out disables direct media and keeps relay available', async () => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await listen(receiver);
    config.webRtc.holepunchMediaEnabled = false;
    await expect(
      sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).resolves.toBeNull();
    expect(runtime.hasDirectMediaCapability(1, StreamKind.SCREEN)).toBe(false);
  });

  test('passes configured ICE servers to mediasoup transports', async () => {
    const { runtime } = await pair();
    config.webRtc.directScreenStunUrls = ['stun:example.org:3478'];
    await runtime.init();
    const params = await runtime.createProducerTransport(1);
    expect(params.iceServers).toEqual([{ urls: ['stun:example.org:3478'] }]);
  });

  test('validates STUN-only lists and their bounds', () => {
    const parse = (directScreenStunUrls: unknown) =>
      zConfig.parse({
        ...defaultConfig,
        webRtc: { ...defaultConfig.webRtc, directScreenStunUrls }
      });
    expect(
      parse('stun:example.org:3478,stuns:example.org:5349').webRtc
        .directScreenStunUrls
    ).toEqual(['stun:example.org:3478', 'stuns:example.org:5349']);
    expect(parse([]).webRtc.directScreenStunUrls).toEqual([]);
    for (const value of [
      ['turn:example.org'],
      ['turns:example.org'],
      ['https://example.org'],
      ['stun:'],
      ['stun:example.org/path'],
      ['stun:user@host'],
      ['stun:host?transport=tcp'],
      ['stun:host:99999'],
      ['stun:host:0'],
      ['stun:host '],
      Array.from({ length: 9 }, () => 'stun:example.org')
    ])
      expect(() => parse(value)).toThrow();
  });

  test('validates TURN URLs and the shared secret', () => {
    const parse = (turnUrls: unknown, turnSecret = '0123456789abcdef') =>
      zConfig.parse({
        ...defaultConfig,
        webRtc: { ...defaultConfig.webRtc, turnUrls, turnSecret }
      });
    expect(
      parse(
        'turn:example.org:3478?transport=udp,turn:example.org:3478?transport=tcp,turns:example.org:5349'
      ).webRtc.turnUrls
    ).toEqual([
      'turn:example.org:3478?transport=udp',
      'turn:example.org:3478?transport=tcp',
      'turns:example.org:5349'
    ]);
    expect(parse([]).webRtc.turnUrls).toEqual([]);
    for (const value of [
      ['stun:example.org:3478'],
      ['https://example.org'],
      ['turn:'],
      ['turn:example.org/path'],
      ['turn:user@host'],
      ['turn:host?transport=sctp'],
      ['turn:host:99999'],
      Array.from({ length: 9 }, () => 'turn:example.org')
    ])
      expect(() => parse(value)).toThrow();
    expect(() => parse([], 'short')).toThrow();
  });

  test('supports validated environment opt-in and STUN configuration', () => {
    const keys = [
      'DODECAGON_WEBRTC_HOLEPUNCH_MEDIA_ENABLED',
      'DODECAGON_WEBRTC_DIRECT_SCREEN_STUN_URLS'
    ];
    const saved = keys.map((key) => process.env[key]);
    try {
      process.env[keys[0]!] = 'true';
      process.env[keys[1]!] = 'stun:example.org:3478';
      const result = zConfig.parse(
        applyEnvOverrides(defaultConfig, envOverridesMap)
      );
      expect(result.webRtc.holepunchMediaEnabled).toBe(true);
      expect(result.webRtc.directScreenStunUrls).toEqual([
        'stun:example.org:3478'
      ]);
      process.env[keys[0]!] = 'false';
      expect(
        zConfig.parse(applyEnvOverrides(defaultConfig, envOverridesMap)).webRtc
          .holepunchMediaEnabled
      ).toBe(false);
      process.env[keys[1]!] = 'turn:example.org';
      expect(() =>
        zConfig.parse(applyEnvOverrides(defaultConfig, envOverridesMap))
      ).toThrow();
    } finally {
      keys.forEach((key, index) => {
        if (saved[index] === undefined) delete process.env[key];
        else process.env[key] = saved[index];
      });
    }
  });
});

describe('startDirectMedia', () => {
  test('requires two actual opted-in subscribers, not just observable creation', async () => {
    const { sender, receiver } = await pair();
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    await listen(sender);
    const observable = await receiver.voice.onDirectMediaSignal({
      enabled: true,
      transport: 'holepunch'
    });
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    const subscription = observable.subscribe({ next: () => {} });
    subscriptions.push(subscription);
    expect(
      (
        await sender.voice.startDirectMedia({
          kind: StreamKind.SCREEN,
          peerId: 2
        })
      )?.peerId
    ).toBe(2);
  });

  test('declines legacy and disabled peers', async () => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await listen(receiver, false);
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    await listen(receiver);
    runtime.removeUser(2);
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
  });

  test('starts one screen session per targeted group viewer', async () => {
    const { runtime, sender, receiver } = await pair();
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    const { caller: third } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await listen(sender);
    await listen(receiver);
    await listen(third);
    const first = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    const second = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 3
    });
    expect(first).toMatchObject({ kind: StreamKind.SCREEN, peerId: 2 });
    expect(second).toMatchObject({ kind: StreamKind.SCREEN, peerId: 3 });
    expect(first?.sessionId).not.toBe(second?.sessionId);
    expect(runtime.getDirectMediaSession(first!.sessionId, 1)).toBeDefined();
    expect(runtime.getDirectMediaSession(second!.sessionId, 1)).toBeDefined();
  });

  test('a viewer fallback leaves the other direct screen sessions running', async () => {
    const { runtime, sender, receiver } = await pair();
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    const { caller: third } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await listen(sender);
    await listen(receiver);
    await listen(third);
    const first = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    const second = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 3
    });
    await receiver.voice.signalDirectMedia({
      sessionId: first!.sessionId,
      signal: { type: 'fallback' }
    });
    expect(runtime.getDirectMediaSession(first!.sessionId, 1)).toBeUndefined();
    expect(runtime.getDirectMediaSession(second!.sessionId, 1)).toBeDefined();
    expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
    expect(runtime.getUserState(2).directMediaEnabled).toBe(true);
  });

  test('hides the relay screen producer only from a ready direct viewer', async () => {
    const { runtime, sender, receiver } = await pair();
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    const { caller: third } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await listen(sender);
    await listen(receiver);
    await listen(third);
    await runtime.init();
    const transport = await runtime.createProducerTransport(1);
    const producerId = await sender.voice.produce({
      transportId: transport.id,
      kind: StreamKind.SCREEN,
      rtpParameters: {
        codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }],
        encodings: [{ ssrc: 9911 }]
      }
    });
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: answer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'ready' }
    });
    expect(runtime.getRemoteIds(2).remoteScreenIds).toEqual([]);
    expect(runtime.getRemoteIds(3).remoteScreenIds).toEqual([1]);
    expect(runtime.getProducer(StreamKind.SCREEN, 1)?.id).toBe(producerId);
  });

  test('returns a server-generated Holepunch session for the explicitly targeted peer', async () => {
    const { sender, receiver } = await pair();
    await listen(sender);
    await listen(receiver);
    config.webRtc.directScreenStunUrls = ['stun:example.org:3478'];
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(session).toEqual({
      kind: StreamKind.SCREEN,
      sessionId: expect.any(String),
      peerId: 2,
      transport: 'holepunch'
    });
    expect(session!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(
      sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).resolves.toBeNull();
  });

  test('allows independent simultaneous opposite shares', async () => {
    const { sender, receiver, session } = await prepared();
    const opposite = await receiver.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 1
    });
    expect(opposite?.peerId).toBe(1);
    expect(opposite?.sessionId).not.toBe(session.sessionId);
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'stop' }
    });
    await receiver.voice.signalDirectMedia({
      sessionId: opposite!.sessionId,
      signal: offer
    });
  });

  for (const kind of [
    StreamKind.AUDIO,
    StreamKind.VIDEO,
    StreamKind.SCREEN
  ] as const) {
    test(`keeps standby and unrelated SFU producers during a direct ${kind} attempt`, async () => {
      const { runtime, sender, receiver } = await pair();
      await listen(sender);
      await runtime.init();
      const transport = await runtime.getRouter().createDirectTransport();
      const producer = await transport.produce({
        kind: kind === StreamKind.AUDIO ? 'audio' : 'video',
        rtpParameters: {
          codecs:
            kind === StreamKind.AUDIO
              ? [
                  {
                    mimeType: 'audio/opus',
                    payloadType: 111,
                    clockRate: 48000,
                    channels: 2
                  }
                ]
              : [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }],
          encodings: [{ ssrc: 1234 }]
        }
      });
      const other = await transport.produce({
        kind: 'video',
        rtpParameters: {
          codecs: [
            { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
          ],
          encodings: [{ ssrc: 5678 }]
        }
      });
      try {
        const otherKind =
          kind === StreamKind.VIDEO ? StreamKind.SCREEN : StreamKind.VIDEO;
        runtime.addProducer(1, kind, producer);
        runtime.addProducer(1, otherKind, other);
        await listen(receiver);
        const session = await sender.voice.startDirectMedia({
          kind,
          peerId: 2
        });
        expect(session).toMatchObject({ kind, peerId: 2 });
        expect(producer.closed).toBe(false);
        expect(runtime.getProducer(kind, 1)).toBe(producer);
        expect(other.closed).toBe(false);
      } finally {
        transport.close();
      }
    });
  }

  test('external streams preserve direct human media alongside relay media', async () => {
    const { runtime, sender, session } = await prepared();
    const externalId = runtime.createExternalStream({
      title: 'external',
      key: 'key',
      pluginId: 'plugin',
      producers: {}
    });
    expect(runtime.getDirectMediaSession(session.sessionId, 1)).toBeDefined();
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
    for (const kind of [StreamKind.AUDIO, StreamKind.VIDEO] as const)
      expect(
        await sender.voice.startDirectMedia({ kind, peerId: 2 })
      ).toMatchObject({
        kind,
        peerId: 2
      });
    expect(runtime.getRemoteIds(1).remoteExternalStreamIds).toEqual([
      externalId
    ]);
  });

  for (const permission of [
    Permission.JOIN_VOICE_CHANNELS,
    Permission.SHARE_SCREEN
  ]) {
    test(`rejects missing global ${permission} permission`, async () => {
      const { receiver } = await pair();
      await revoke(permission);
      await expect(
        receiver.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 1 })
      ).rejects.toThrow('Insufficient permissions');
    });
  }

  test('checks runtime existence, actual membership and input shape', async () => {
    const { sender } = await pair();
    const { caller: absent } = await initTest(3);
    await expect(
      absent.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).rejects.toThrow('User is not in a voice channel');
    const { caller: missing } = await initTest(3, undefined, {
      currentVoiceChannelId: 999999
    });
    await expect(
      missing.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).rejects.toThrow();
    const { caller: outsider } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await expect(
      outsider.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).rejects.toThrow('User is not in this voice channel');
    await expect(
      sender.voice.startDirectMedia({ peerId: 3 } as never)
    ).rejects.toThrow();
  });

  test('rejects a sender without channel view or share access', async () => {
    const { receiver } = await pair(4);
    await expect(
      receiver.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 1 })
    ).rejects.toThrow('Insufficient channel permissions');
    await tdb.insert(channelRolePermissions).values({
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.VIEW_CHANNEL,
      allow: true,
      createdAt: Date.now()
    });
    await expect(
      receiver.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 1 })
    ).rejects.toThrow('Insufficient channel permissions');
  });

  test('declines a receiver who cannot view the channel', async () => {
    const { sender, receiver } = await pair(4);
    await listen(sender);
    await tdb.insert(channelRolePermissions).values({
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.VIEW_CHANNEL,
      allow: true,
      createdAt: Date.now()
    });
    await listen(receiver);
    await tdb
      .delete(channelRolePermissions)
      .where(eq(channelRolePermissions.channelId, 4));
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
  });

  test('rate limits session preparation', async () => {
    const { sender } = await pair();
    for (
      let index = 0;
      index < config.rateLimiters.voiceStream.maxRequests;
      index++
    ) {
      expect(
        await sender.voice.startDirectMedia({
          kind: StreamKind.SCREEN,
          peerId: 2
        })
      ).toBeNull();
    }
    await expect(
      sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
    ).rejects.toThrow('Too many requests');
  });
});

describe('onDirectMediaSignal', () => {
  test('requires membership, current runtime and channel visibility', async () => {
    await pair();
    const { caller: absent } = await initTest(3);
    await expect(
      absent.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow();
    const { caller: outsider } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await expect(
      outsider.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow('User is not in this voice channel');
    const { caller: missing } = await initTest(3, undefined, {
      currentVoiceChannelId: 999999
    });
    await expect(
      missing.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow();
    const privateRuntime = new VoiceRuntime(4);
    runtimes.push(privateRuntime);
    privateRuntime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    const { caller: privateCaller } = await initTest(3, undefined, {
      currentVoiceChannelId: 4
    });
    await expect(
      privateCaller.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow('Insufficient channel permissions');
  });

  test('checks global join permission and validates enabled', async () => {
    const { receiver } = await pair();
    await expect(
      receiver.voice.onDirectMediaSignal({ enabled: 'true' } as never)
    ).rejects.toThrow();
    await revoke(Permission.JOIN_VOICE_CHANNELS);
    await expect(
      receiver.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow('Insufficient permissions');
  });

  test('overlapping subscription cleanup never revives an older enabled capability', async () => {
    const { sender, receiver } = await pair();
    await listen(sender);
    const old = await listen(receiver);
    const current = await listen(receiver);
    old.subscription.unsubscribe();
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).not.toBeNull();
    const disabled = await listen(receiver, false);
    disabled.subscription.unsubscribe();
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    current.subscription.unsubscribe();
    await listen(receiver);
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).not.toBeNull();
  });

  test('rate limits subscription registration attempts', async () => {
    const { sender } = await pair();
    for (
      let index = 0;
      index < config.rateLimiters.voiceStream.maxRequests;
      index++
    ) {
      await sender.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      });
    }
    await expect(
      sender.voice.onDirectMediaSignal({
        enabled: true,
        transport: 'holepunch'
      })
    ).rejects.toThrow('Too many requests');
  });

  test('a delayed observable cannot revive capability after leave and rejoin', async () => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    const delayed = await receiver.voice.onDirectMediaSignal({
      enabled: true,
      transport: 'holepunch'
    });
    runtime.removeUser(2);
    runtime.addUser(
      2,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(2)
    );
    subscriptions.push(delayed.subscribe({ next: () => {} }));
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
  });

  test('a moderator move blocks delayed and fresh capability subscriptions until rejoin', async () => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    const delayed = await receiver.voice.onDirectMediaSignal({
      enabled: true,
      transport: 'holepunch'
    });
    await sender.voice.moveUser({ userId: 2, channelId: 4 });
    subscriptions.push(delayed.subscribe({ next: () => {} }));
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    await listen(receiver);
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    runtime.removeUser(2);
    runtime.addUser(
      2,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(2)
    );
    await listen(receiver);
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(session?.peerId).toBe(2);
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'stop' }
    });
  });

  test('ordinary subscription cleanup allows a new subscription in the same membership', async () => {
    const { sender, receiver } = await pair();
    await listen(sender);
    const current = await listen(receiver);
    current.subscription.unsubscribe();
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    await listen(receiver);
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(session?.peerId).toBe(2);
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'stop' }
    });
  });
});

describe('signalDirectMedia', () => {
  test('delivers SDP only to its paired peer and never broadcasts it', async () => {
    const { sender, receiver, sending, receiving, session } = await prepared();
    const broadcasts: TDirectMediaEvent[] = [];
    const others: TDirectMediaEvent[] = [];
    subscriptions.push(
      pubsub
        .subscribe(ServerEvents.DIRECT_MEDIA_SIGNAL)
        .subscribe({ next: (event) => broadcasts.push(event) })
    );
    subscriptions.push(
      pubsub
        .subscribeFor(3, ServerEvents.DIRECT_MEDIA_SIGNAL)
        .subscribe({ next: (event) => others.push(event) })
    );
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
    expect(sending.events).toEqual([]);
    expect(receiving.events).toEqual([
      {
        kind: StreamKind.SCREEN,
        relayAllowed: true,
        sessionId: session.sessionId,
        channelId: 2,
        senderId: 1,
        fromUserId: 1,
        transport: 'holepunch',
        signal: offer
      }
    ]);
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: answer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'ready' }
    });
    expect(sending.events.map((event) => event.signal.type)).toEqual([
      'answer',
      'ready'
    ]);
    expect(broadcasts).toEqual([]);
    expect(others).toEqual([]);
    expect(
      testLogs.some(
        (entry) =>
          entry.message.includes(offer.sdp) ||
          entry.message.includes(answer.sdp)
      )
    ).toBe(false);
  });

  test('enforces direction and offer-answer-ready order without advancing on rejection', async () => {
    const { sender, receiver, session } = await prepared();
    const send = sender.voice.signalDirectMedia;
    const receive = receiver.voice.signalDirectMedia;
    await expect(
      receive({ sessionId: session.sessionId, signal: offer })
    ).rejects.toThrow();
    await expect(
      send({ sessionId: session.sessionId, signal: answer })
    ).rejects.toThrow();
    await expect(
      send({ sessionId: session.sessionId, signal: { type: 'ready' } })
    ).rejects.toThrow();
    await expect(
      receive({ sessionId: session.sessionId, signal: answer })
    ).rejects.toThrow();
    await expect(
      receive({ sessionId: session.sessionId, signal: { type: 'ready' } })
    ).rejects.toThrow();
    await send({ sessionId: session.sessionId, signal: offer });
    await expect(
      send({ sessionId: session.sessionId, signal: offer })
    ).rejects.toThrow();
    await expect(
      receive({ sessionId: session.sessionId, signal: { type: 'ready' } })
    ).rejects.toThrow();
    await receive({ sessionId: session.sessionId, signal: answer });
    await expect(
      receive({ sessionId: session.sessionId, signal: answer })
    ).rejects.toThrow();
    await receive({ sessionId: session.sessionId, signal: { type: 'ready' } });
    await expect(
      receive({ sessionId: session.sessionId, signal: { type: 'ready' } })
    ).rejects.toThrow();
  });

  test('rejects unknown, oversized, malformed and unexpected signalling fields', async () => {
    const { sender, session } = await prepared();
    for (const signal of [
      { type: 'offer', sdp: '', publicKey: 'a'.repeat(64) },
      { type: 'offer', sdp: 'not SDP', publicKey: 'a'.repeat(64) },
      {
        type: 'offer',
        sdp: `v=0\r\n${'x'.repeat(65536)}`,
        publicKey: 'a'.repeat(64)
      },
      {
        type: 'offer',
        sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',
        publicKey: 'a'.repeat(64)
      },
      { type: 'candidate', candidate: 'private IP' },
      { type: 'stop', sdp: 'private SDP' },
      { type: 'ready', peerId: 3 }
    ])
      await expect(
        sender.voice.signalDirectMedia({
          sessionId: session.sessionId,
          signal
        } as never)
      ).rejects.toThrow();
    await expect(
      sender.voice.signalDirectMedia({ sessionId: '', signal: offer })
    ).rejects.toThrow();
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: 'not-a-uuid',
        signal: offer
      })
    ).rejects.toThrow();
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: crypto.randomUUID(),
        signal: offer
      })
    ).rejects.toThrow('Direct screen session not found');
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
  });

  test('rejects outsiders and cross-runtime session IDs without disclosing the session', async () => {
    const { sender, session } = await prepared();
    const { caller: outsider } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await expect(
      outsider.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: offer
      })
    ).rejects.toThrow('Direct screen session not found');
    for (const signal of [{ type: 'fallback' }, { type: 'stop' }] as const) {
      await outsider.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal
      });
      await outsider.voice.signalDirectMedia({
        sessionId: crypto.randomUUID(),
        signal
      });
    }
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
    const runtime = new VoiceRuntime(4);
    runtimes.push(runtime);
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    const { caller: elsewhere } = await initTest(1, undefined, {
      currentVoiceChannelId: 4
    });
    await expect(
      elsewhere.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: offer
      })
    ).rejects.toThrow('Direct screen session not found');
  });

  for (const permission of [
    Permission.JOIN_VOICE_CHANNELS,
    Permission.SHARE_SCREEN
  ]) {
    test(`checks global ${permission} before signalling`, async () => {
      const { receiver, session } = await prepared();
      const outgoing =
        permission === Permission.SHARE_SCREEN
          ? await receiver.voice.startDirectMedia({
              kind: StreamKind.SCREEN,
              peerId: 1
            })
          : session;
      await revoke(permission);
      await expect(
        receiver.voice.signalDirectMedia({
          sessionId: outgoing!.sessionId,
          signal: permission === Permission.SHARE_SCREEN ? offer : answer
        })
      ).rejects.toThrow('Insufficient permissions');
    });
  }

  test('permits terminal cleanup after disabling the feature, once only', async () => {
    const { sender, sending, receiving, session } = await prepared();
    config.webRtc.holepunchMediaEnabled = false;
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: offer
      })
    ).rejects.toThrow();
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'fallback' }
    });
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'stop' }
    });
    expect(sending.events.map((event) => event.signal.type)).toEqual([
      'fallback'
    ]);
    expect(receiving.events.map((event) => event.signal.type)).toEqual([
      'fallback'
    ]);
    await sender.voice.signalDirectMedia({
      sessionId: crypto.randomUUID(),
      signal: { type: 'stop' }
    });
  });

  test('rate limits invalid signalling requests', async () => {
    const { sender } = await pair();
    const sessionId = crypto.randomUUID();
    for (
      let index = 0;
      index < config.rateLimiters.voiceStream.maxRequests;
      index++
    ) {
      await expect(
        sender.voice.signalDirectMedia({ sessionId, signal: offer })
      ).rejects.toThrow('Direct screen session not found');
    }
    await expect(
      sender.voice.signalDirectMedia({ sessionId, signal: offer })
    ).rejects.toThrow('Too many requests');
  });
});

describe('direct screen lifecycle', () => {
  for (const action of [
    'leave',
    'move',
    'subscription',
    'capture',
    'destroy'
  ] as const) {
    test(`ends sessions on ${action} without stale session resurrection`, async () => {
      const { runtime, sender, receiver, sending, receiving, session } =
        await prepared();
      if (action === 'leave') runtime.removeUser(2);
      if (action === 'move')
        await sender.voice.moveUser({ userId: 2, channelId: 4 });
      if (action === 'subscription') receiving.subscription.unsubscribe();
      if (action === 'capture')
        await sender.voice.updateState({ sharingScreen: false });
      if (action === 'destroy') await runtime.destroy();
      expect(sending.events.map((event) => event.signal.type)).toEqual([
        action === 'capture' || action === 'destroy' ? 'stop' : 'fallback'
      ]);
      if (action !== 'subscription') expect(receiving.events).toHaveLength(1);
      await expect(
        sender.voice.signalDirectMedia({
          sessionId: session.sessionId,
          signal: offer
        })
      ).rejects.toThrow();
      await sender.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type: 'stop' }
      });
      await receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type: 'fallback' }
      });
    });
  }

  test('a returning participant needs a new live capability registration', async () => {
    const { runtime, sender, session } = await prepared();
    runtime.removeUser(2);
    runtime.addUser(
      2,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(2)
    );
    expect(
      await sender.voice.startDirectMedia({
        kind: StreamKind.SCREEN,
        peerId: 2
      })
    ).toBeNull();
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: offer
      })
    ).rejects.toThrow('Direct screen session not found');
  });

  test('expires a pending screen session and latches only that pair until rejoin', async () => {
    const time = clock();
    const { runtime, sender, sending, session } = await prepared();
    time.advance(8200);
    expect(sending.events.map((event) => event.signal.type)).toEqual([
      'fallback'
    ]);
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: offer
      })
    ).rejects.toThrow('Direct screen session not found');
    expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
    expect(runtime.getUserState(2).directMediaEnabled).toBe(true);
    const replacement = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(replacement).toBeNull();
  });

  test('ready clears the pending deadline', async () => {
    const time = clock();
    const { sender, receiver, sending, session } = await prepared();
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: answer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'ready' }
    });
    time.advance(8200);
    expect(sending.events.map((event) => event.signal.type)).toEqual([
      'answer',
      'ready'
    ]);
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'stop' }
    });
    expect(sending.events.at(-1)?.signal.type).toBe('stop');
  });
});

test('all direct screen endpoints require authentication', async () => {
  const { caller } = await getCaller(1, undefined, { authenticated: false });
  await expect(
    caller.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
  ).rejects.toThrow('You must be authenticated');
  await expect(
    caller.voice.onDirectMediaSignal({ enabled: true, transport: 'holepunch' })
  ).rejects.toThrow('You must be authenticated');
  await expect(
    caller.voice.signalDirectMedia({
      sessionId: crypto.randomUUID(),
      signal: { type: 'stop' }
    })
  ).rejects.toThrow('You must be authenticated');
});

test('screen signalling rechecks channel permissions before exposing SDP', async () => {
  const { sender, receiver } = await pair(4);
  await tdb.insert(channelRolePermissions).values([
    {
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.VIEW_CHANNEL,
      allow: true,
      createdAt: Date.now()
    },
    {
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.SHARE_SCREEN,
      allow: true,
      createdAt: Date.now()
    }
  ]);
  const sending = await listen(sender);
  const receiving = await listen(receiver);
  const session = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  await tdb
    .delete(channelRolePermissions)
    .where(eq(channelRolePermissions.channelId, 4));
  await expect(
    sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: offer
    })
  ).rejects.toThrow('Direct screen session not found');
  expect(receiving.events.map((event) => event.signal.type)).toEqual([
    'fallback'
  ]);
  expect(sending.events.map((event) => event.signal.type)).toEqual([
    'fallback'
  ]);
});

test('screen offers need channel share permission but receive and cleanup do not', async () => {
  const { sender, receiver } = await pair(4);
  await tdb.insert(channelRolePermissions).values([
    {
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.VIEW_CHANNEL,
      allow: true,
      createdAt: Date.now()
    },
    {
      channelId: 4,
      roleId: 2,
      permission: ChannelPermission.SHARE_SCREEN,
      allow: true,
      createdAt: Date.now()
    }
  ]);
  await listen(sender);
  await listen(receiver);
  const session = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  const opposite = await receiver.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 1
  });
  await sender.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: offer
  });
  await tdb
    .delete(channelRolePermissions)
    .where(
      and(
        eq(channelRolePermissions.channelId, 4),
        eq(channelRolePermissions.permission, ChannelPermission.SHARE_SCREEN)
      )
    );
  await expect(
    receiver.voice.signalDirectMedia({
      sessionId: opposite!.sessionId,
      signal: offer
    })
  ).rejects.toThrow('Insufficient channel permissions');
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: answer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'ready' }
  });
  await receiver.voice.signalDirectMedia({
    sessionId: opposite!.sessionId,
    signal: { type: 'stop' }
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'fallback' }
  });
});

test('a receive-only peer without global share permission can negotiate and clean up', async () => {
  const { sender, receiver } = await pair();
  await revoke(Permission.SHARE_SCREEN);
  const sending = await listen(sender);
  await listen(receiver);
  const session = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  await sender.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: offer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: answer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'ready' }
  });
  expect(sending.events.map((event) => event.signal.type)).toEqual([
    'answer',
    'ready'
  ]);
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'stop' }
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'fallback' }
  });
  await expect(
    receiver.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 1 })
  ).rejects.toThrow('Insufficient permissions');
});

test.each([StreamKind.AUDIO, StreamKind.VIDEO, StreamKind.SCREEN])(
  'isolates a failed %s pair among three native peers and a browser',
  async (kind) => {
    const { runtime, sender, receiver } = await pair();
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    runtime.addUser(
      4,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(4)
    );
    const { caller: third } = await initTest(3, undefined, {
      currentVoiceChannelId: 2
    });
    await listen(sender);
    await listen(receiver);
    await listen(third);
    runtime.registerDirectMediaSubscriber(4, false);
    const first = await sender.voice.startDirectMedia({ kind, peerId: 2 });
    const second = await sender.voice.startDirectMedia({ kind, peerId: 3 });
    expect(first).toMatchObject({ kind, peerId: 2, transport: 'holepunch' });
    expect(second).toMatchObject({ kind, peerId: 3, transport: 'holepunch' });
    expect(await sender.voice.startDirectMedia({ kind, peerId: 4 })).toBeNull();
    await sender.voice.signalDirectMedia({
      sessionId: second!.sessionId,
      signal: offer
    });
    await third.voice.signalDirectMedia({
      sessionId: second!.sessionId,
      signal: answer
    });
    await third.voice.signalDirectMedia({
      sessionId: second!.sessionId,
      signal: { type: 'ready' }
    });
    await receiver.voice.signalDirectMedia({
      sessionId: first!.sessionId,
      signal: { type: 'fallback' }
    });
    expect(runtime.getDirectMediaSession(first!.sessionId, 1)).toBeUndefined();
    expect(runtime.getDirectMediaSession(second!.sessionId, 1)?.phase).toBe(
      'ready'
    );
    expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
    expect(runtime.getUserState(2).directMediaEnabled).toBe(true);
    expect(await sender.voice.startDirectMedia({ kind, peerId: 2 })).toBeNull();
  }
);

test('rejects missing or non-hex Holepunch keys without advancing offer or answer', async () => {
  const { sender, receiver, session } = await prepared();
  for (const publicKey of [undefined, '', 'a'.repeat(63), 'g'.repeat(64)]) {
    await expect(
      sender.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { ...offer, publicKey } as never
      })
    ).rejects.toThrow();
  }
  await expect(
    sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { ...offer, publicKey: 'AB'.repeat(32) }
    })
  ).resolves.toBeUndefined();
  for (const publicKey of [undefined, '', 'b'.repeat(65), 'x'.repeat(64)]) {
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { ...answer, publicKey } as never
      })
    ).rejects.toThrow();
  }
  await expect(
    receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { ...answer, publicKey: 'CD'.repeat(32) }
    })
  ).resolves.toBeUndefined();
});

const addScreenRelayMedia = async (
  runtime: VoiceRuntime,
  kind: StreamKind.SCREEN | StreamKind.SCREEN_AUDIO,
  ssrc: number
) => {
  const transport = await runtime.getRouter().createDirectTransport();
  const audio = kind === StreamKind.SCREEN_AUDIO;
  const producer = await transport.produce({
    kind: audio ? 'audio' : 'video',
    rtpParameters: {
      codecs: [
        audio
          ? {
              mimeType: 'audio/opus',
              payloadType: 111,
              clockRate: 48000,
              channels: 2
            }
          : { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
      ],
      encodings: [{ ssrc }]
    }
  });
  runtime.addProducer(1, kind, producer);
  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities: runtime.getRouter().rtpCapabilities
  });
  runtime.addConsumer(2, 1, kind, consumer);
  return { transport, producer, consumer };
};

const readyDirectScreen = async (
  sender: TTestCaller,
  receiver: TTestCaller
) => {
  const session = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  await sender.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: offer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: answer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: { type: 'ready' }
  });
  return session!;
};

test('retains one paused screen relay bundle through direct playback and resumes it on fallback', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7711);
  const screenAudio = await addScreenRelayMedia(
    runtime,
    StreamKind.SCREEN_AUDIO,
    7712
  );
  const discovery: unknown[] = [];
  subscriptions.push(
    (await receiver.voice.onNewProducer()).subscribe({
      next: (event) => discovery.push(event)
    })
  );
  const originalIds = [screen.consumer.id, screenAudio.consumer.id];
  try {
    const session = await readyDirectScreen(sender, receiver);
    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN)).toBe(screen.consumer);
    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN_AUDIO)).toBe(
      screenAudio.consumer
    );
    expect(screen.consumer.closed).toBe(false);
    expect(screenAudio.consumer.closed).toBe(false);
    expect(screen.consumer.paused).toBe(true);
    expect(screenAudio.consumer.paused).toBe(true);
    expect([
      runtime.getConsumer(2, 1, StreamKind.SCREEN)!.id,
      runtime.getConsumer(2, 1, StreamKind.SCREEN_AUDIO)!.id
    ]).toEqual(originalIds);
    expect(discovery).toEqual([]);

    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'fallback' }
    });

    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN)).toBe(screen.consumer);
    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN_AUDIO)).toBe(
      screenAudio.consumer
    );
    expect(screen.consumer.paused).toBe(false);
    expect(screenAudio.consumer.paused).toBe(false);
    expect([
      runtime.getConsumer(2, 1, StreamKind.SCREEN)!.id,
      runtime.getConsumer(2, 1, StreamKind.SCREEN_AUDIO)!.id
    ]).toEqual(originalIds);
    expect(discovery).toEqual([]);
  } finally {
    screen.transport.close();
    screenAudio.transport.close();
  }
});

test('screen audio resume preserves a newly pending direct screen attempt', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7716);
  const screenAudio = await addScreenRelayMedia(
    runtime,
    StreamKind.SCREEN_AUDIO,
    7717
  );
  try {
    await receiver.voice.resumeConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN,
      consumerId: screen.consumer.id,
      requestDirect: false
    });
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    expect(session).not.toBeNull();
    expect(runtime.getDirectMediaSession(session!.sessionId, 1)?.phase).toBe(
      'pending'
    );

    await receiver.voice.resumeConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN_AUDIO,
      consumerId: screenAudio.consumer.id,
      requestDirect: false
    });

    expect(runtime.getDirectMediaSession(session!.sessionId, 1)?.phase).toBe(
      'pending'
    );
  } finally {
    screen.transport.close();
    screenAudio.transport.close();
  }
});

test('pre-activation fallback resumes the paused screen relay bundle', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7718);
  const screenAudio = await addScreenRelayMedia(
    runtime,
    StreamKind.SCREEN_AUDIO,
    7719
  );
  try {
    await receiver.voice.pauseConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN
    });
    await receiver.voice.pauseConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN_AUDIO
    });
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: answer
    });

    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'fallback' }
    });

    expect(screen.consumer.paused).toBe(false);
    expect(screenAudio.consumer.paused).toBe(false);
  } finally {
    screen.transport.close();
    screenAudio.transport.close();
  }
});

test('rewatch during relay activation wins over the earlier unwatch', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7713);
  const session = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  await sender.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: offer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session!.sessionId,
    signal: answer
  });
  const pauseStarted = Promise.withResolvers<void>();
  const releasePause = Promise.withResolvers<void>();
  const originalPause = screen.consumer.pause.bind(screen.consumer);
  const pauseSpy = spyOn(screen.consumer, 'pause').mockImplementation(
    async () => {
      pauseStarted.resolve();
      await releasePause.promise;
      await originalPause();
    }
  );
  try {
    const activating = receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'ready' }
    });
    await pauseStarted.promise;
    const unwatch = receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'fallback', reason: 'unwatch' }
    });
    for (
      let turn = 0;
      turn < 50 &&
      runtime.getDirectMediaSession(session!.sessionId, 2, true)?.phase !==
        'retiring';
      turn++
    ) {
      await Promise.resolve();
    }
    expect(
      runtime.getDirectMediaSession(session!.sessionId, 2, true)?.phase
    ).toBe('retiring');
    const rewatch = receiver.voice.resumeConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN,
      consumerId: screen.consumer.id,
      requestDirect: false
    });
    releasePause.resolve();
    await Promise.all([activating, unwatch, rewatch]);
    expect(screen.consumer.paused).toBe(false);
    expect(
      runtime.getDirectMediaSession(session!.sessionId, 2, true)
    ).toBeUndefined();
  } finally {
    pauseSpy.mockRestore();
    screen.transport.close();
  }
});

test('unwatch during relay restoration leaves the retained consumer paused', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7714);
  const session = await readyDirectScreen(sender, receiver);
  const resumeStarted = Promise.withResolvers<void>();
  const releaseResume = Promise.withResolvers<void>();
  const originalResume = screen.consumer.resume.bind(screen.consumer);
  const resumeSpy = spyOn(screen.consumer, 'resume').mockImplementation(
    async () => {
      resumeStarted.resolve();
      await releaseResume.promise;
      await originalResume();
    }
  );
  try {
    const fallback = receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'fallback' }
    });
    await resumeStarted.promise;
    const unwatch = receiver.voice.pauseConsumer({
      remoteId: 1,
      kind: StreamKind.SCREEN
    });
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    releaseResume.resolve();
    await Promise.all([fallback, unwatch]);
    expect(screen.consumer.paused).toBe(true);
    expect(
      runtime.getDirectMediaSession(session.sessionId, 2, true)
    ).toBeUndefined();
  } finally {
    resumeSpy.mockRestore();
    screen.transport.close();
  }
});

test('a disappearing retained consumer cannot strand direct retirement', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7715);
  const discovery: unknown[] = [];
  subscriptions.push(
    (await receiver.voice.onNewProducer()).subscribe({
      next: (event) => discovery.push(event)
    })
  );
  const session = await readyDirectScreen(sender, receiver);
  const resumeSpy = spyOn(screen.consumer, 'resume').mockImplementation(
    async () => {
      screen.consumer.close();
      throw new Error('retained consumer disappeared');
    }
  );
  try {
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type: 'stop' }
      })
    ).resolves.toBeUndefined();
    expect(
      runtime.getDirectMediaSession(session.sessionId, 2, true)
    ).toBeUndefined();
    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN)).toBeUndefined();
    expect(discovery).toEqual([
      {
        channelId: 2,
        remoteId: 1,
        kind: StreamKind.SCREEN,
        replaceConsumerId: screen.consumer.id
      }
    ]);
    expect(runtime.startDirectMedia(1, StreamKind.SCREEN, 2)).not.toBeNull();
  } finally {
    resumeSpy.mockRestore();
    screen.transport.close();
  }
});

test('discovers only a missing member of a retained screen relay bundle on fallback', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7721);
  const screenAudio = await addScreenRelayMedia(
    runtime,
    StreamKind.SCREEN_AUDIO,
    7722
  );
  const discovery: unknown[] = [];
  subscriptions.push(
    (await receiver.voice.onNewProducer()).subscribe({
      next: (event) => discovery.push(event)
    })
  );
  try {
    const session = await sender.voice.startDirectMedia({
      kind: StreamKind.SCREEN,
      peerId: 2
    });
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: answer
    });
    screenAudio.consumer.close();
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'ready' }
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'fallback' }
    });
    expect(runtime.getConsumer(2, 1, StreamKind.SCREEN)).toBe(screen.consumer);
    expect(screen.consumer.paused).toBe(false);
    expect(discovery).toEqual([
      {
        channelId: 2,
        remoteId: 1,
        kind: StreamKind.SCREEN_AUDIO,
        replaceConsumerId: screenAudio.consumer.id
      }
    ]);

    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'fallback' }
    });
    expect(discovery).toHaveLength(1);
  } finally {
    screen.transport.close();
    screenAudio.transport.close();
  }
});

test('fallback discovers a relay member that disappears during sibling restoration', async () => {
  const { runtime, sender, receiver } = await pair();
  await listen(sender);
  await listen(receiver);
  await runtime.init();
  const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7723);
  const screenAudio = await addScreenRelayMedia(
    runtime,
    StreamKind.SCREEN_AUDIO,
    7724
  );
  const discovery: unknown[] = [];
  subscriptions.push(
    (await receiver.voice.onNewProducer()).subscribe({
      next: (event) => discovery.push(event)
    })
  );
  const session = await readyDirectScreen(sender, receiver);
  const audioResumeStarted = Promise.withResolvers<void>();
  const releaseAudioResume = Promise.withResolvers<void>();
  const originalAudioResume = screenAudio.consumer.resume.bind(
    screenAudio.consumer
  );
  const resumeSpy = spyOn(screenAudio.consumer, 'resume').mockImplementation(
    async () => {
      audioResumeStarted.resolve();
      await releaseAudioResume.promise;
      await originalAudioResume();
    }
  );
  try {
    const fallback = receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'fallback' }
    });
    await audioResumeStarted.promise;
    screen.consumer.close();
    releaseAudioResume.resolve();
    await fallback;

    expect(discovery).toEqual([
      {
        channelId: 2,
        remoteId: 1,
        kind: StreamKind.SCREEN,
        replaceConsumerId: screen.consumer.id
      }
    ]);
  } finally {
    resumeSpy.mockRestore();
    releaseAudioResume.resolve();
    screen.transport.close();
    screenAudio.transport.close();
  }
});

test.each(['unwatch', 'voice-only', 'producer-close'] as const)(
  '%s retires direct screen playback without restoring or rediscovering relay media',
  async (action) => {
    const { runtime, sender, receiver } = await pair();
    await listen(sender);
    await listen(receiver);
    await runtime.init();
    const screen = await addScreenRelayMedia(runtime, StreamKind.SCREEN, 7731);
    const screenAudio = await addScreenRelayMedia(
      runtime,
      StreamKind.SCREEN_AUDIO,
      7732
    );
    const discovery: unknown[] = [];
    subscriptions.push(
      (await receiver.voice.onNewProducer()).subscribe({
        next: (event) => discovery.push(event)
      })
    );
    try {
      const session = await readyDirectScreen(sender, receiver);
      if (action === 'unwatch') {
        await receiver.voice.signalDirectMedia({
          sessionId: session.sessionId,
          signal: { type: 'fallback', reason: 'unwatch' }
        });
      } else if (action === 'voice-only') {
        await receiver.voice.updateState({ voiceOnlyMode: true });
      } else {
        screen.producer.close();
      }
      expect(
        runtime.getDirectMediaSession(session.sessionId, 1)
      ).toBeUndefined();
      expect(discovery).toEqual([]);
      expect(runtime.getRelayDemand(1)).toEqual(
        expect.arrayContaining([
          {
            channelId: 2,
            kind: StreamKind.SCREEN,
            required: false
          },
          {
            channelId: 2,
            kind: StreamKind.SCREEN_AUDIO,
            required: false
          }
        ])
      );
    } finally {
      screen.transport.close();
      screenAudio.transport.close();
    }
  }
);

test.each([StreamKind.AUDIO, StreamKind.VIDEO])(
  'switches only the ready %s pair off relay and restores it on fallback',
  async (kind) => {
    const { runtime, sender, receiver } = await pair();
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    await listen(sender);
    await listen(receiver);
    await runtime.init();
    const transport = await runtime.getRouter().createDirectTransport();
    const audio = kind === StreamKind.AUDIO;
    const producer = await transport.produce({
      kind: audio ? 'audio' : 'video',
      rtpParameters: {
        codecs: [
          audio
            ? {
                mimeType: 'audio/opus',
                payloadType: 111,
                clockRate: 48000,
                channels: 2
              }
            : { mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }
        ],
        encodings: [{ ssrc: 7711 }]
      }
    });
    runtime.addProducer(1, kind, producer);
    const relay = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: runtime.getRouter().rtpCapabilities
    });
    runtime.addConsumer(2, 1, kind, relay);
    const discovery: unknown[] = [];
    const observable = await receiver.voice.onNewProducer();
    subscriptions.push(
      observable.subscribe({ next: (event) => discovery.push(event) })
    );
    const demand: TRelayDemandEvent[] = [];
    subscriptions.push(
      (await sender.voice.onRelayDemand()).subscribe({
        next: (event) => demand.push(event)
      })
    );
    expect(demand).toContainEqual({ channelId: 2, kind, required: true });
    const session = await sender.voice.startDirectMedia({ kind, peerId: 2 });
    await sender.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: answer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'ready' }
    });
    const ids = (peerId: number) => {
      const remote = runtime.getRemoteIds(peerId);
      return kind === StreamKind.AUDIO
        ? remote.remoteAudioIds
        : remote.remoteVideoIds;
    };
    expect(relay.closed).toBe(true);
    expect(producer.closed).toBe(false);
    expect(ids(2)).toEqual([]);
    expect(ids(3)).toEqual([1]);
    expect(demand.filter((event) => event.kind === kind).at(-1)?.required).toBe(
      false
    );
    await receiver.voice.signalDirectMedia({
      sessionId: session!.sessionId,
      signal: { type: 'fallback' }
    });
    expect(ids(2)).toEqual([1]);
    expect(discovery).toEqual([{ channelId: 2, remoteId: 1, kind }]);
    const fallback = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: runtime.getRouter().rtpCapabilities
    });
    runtime.addConsumer(2, 1, kind, fallback);
    expect(demand.filter((event) => event.kind === kind).at(-1)?.required).toBe(
      true
    );
    await fallback.pause();
    expect(demand.filter((event) => event.kind === kind).at(-1)?.required).toBe(
      false
    );
    await fallback.resume();
    expect(demand.filter((event) => event.kind === kind).at(-1)?.required).toBe(
      true
    );
    producer.close();
    expect(
      runtime.getDirectMediaSession(session!.sessionId, 1)
    ).toBeUndefined();
    transport.close();
  }
);

test('direct routes require explicit peer and actual native transport', async () => {
  const { sender } = await pair();
  await expect(
    sender.voice.startDirectMedia({ kind: StreamKind.AUDIO } as never)
  ).rejects.toThrow();
  for (const transport of [undefined, 'webrtc', 'mediasoup']) {
    await expect(
      sender.voice.onDirectMediaSignal({ enabled: true, transport } as never)
    ).rejects.toThrow();
  }
});

test('native direct media is available by default without disabling browser relay', async () => {
  const { sender, receiver } = await pair();
  config.webRtc.holepunchMediaEnabled =
    zConfig.parse(defaultConfig).webRtc.holepunchMediaEnabled;
  await listen(sender);
  await listen(receiver);
  expect(
    await sender.voice.startDirectMedia({ kind: StreamKind.AUDIO, peerId: 2 })
  ).toMatchObject({ transport: 'holepunch', peerId: 2 });
});

test('relay demand requires current membership and sends an initial snapshot', async () => {
  const { sender } = await pair();
  const events: unknown[] = [];
  subscriptions.push(
    (await sender.voice.onRelayDemand()).subscribe({
      next: (event) => events.push(event)
    })
  );
  expect(events).toEqual([
    { channelId: 2, kind: StreamKind.AUDIO, required: false },
    { channelId: 2, kind: StreamKind.VIDEO, required: false },
    { channelId: 2, kind: StreamKind.SCREEN, required: false },
    { channelId: 2, kind: StreamKind.SCREEN_AUDIO, required: false }
  ]);
  const { caller: outsider } = await initTest(3, undefined, {
    currentVoiceChannelId: 2
  });
  await expect(outsider.voice.onRelayDemand()).rejects.toThrow(
    'User is not in this voice channel'
  );
  const { caller: anonymous } = await getCaller(1, undefined, {
    authenticated: false
  });
  await expect(anonymous.voice.onRelayDemand()).rejects.toThrow(
    'You must be authenticated'
  );
});

test('legacy persisted direct-screen defaults do not disable native Holepunch', () => {
  const migrated = zConfig.parse(
    deepMerge(
      defaultConfig,
      parse('[webRtc]\ndirectScreenSharing=false\nport=40000\n')
    )
  );
  expect(migrated.webRtc.holepunchMediaEnabled).toBe(true);
  expect(migrated.webRtc).not.toHaveProperty('directScreenSharing');
  const explicitlyDisabled = zConfig.parse(
    deepMerge(defaultConfig, parse('[webRtc]\nholepunchMediaEnabled=false\n'))
  );
  expect(explicitlyDisabled.webRtc.holepunchMediaEnabled).toBe(false);
});

test('receiver unwatch can rewatch the same source without clearing real pair failures', async () => {
  const { runtime, sender, receiver, session } = await prepared();
  await expect(
    sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'fallback', reason: 'unwatch' }
    })
  ).rejects.toThrow('Only the receiver can cancel watching');
  expect(runtime.getDirectMediaSession(session.sessionId, 1)).toBeDefined();
  await sender.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: offer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: answer
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: { type: 'ready' }
  });
  await receiver.voice.signalDirectMedia({
    sessionId: session.sessionId,
    signal: { type: 'fallback', reason: 'unwatch' }
  });
  const rewatch = await sender.voice.startDirectMedia({
    kind: StreamKind.SCREEN,
    peerId: 2
  });
  expect(rewatch).not.toBeNull();
  await receiver.voice.signalDirectMedia({
    sessionId: rewatch!.sessionId,
    signal: { type: 'fallback' }
  });
  expect(
    await sender.voice.startDirectMedia({ kind: StreamKind.SCREEN, peerId: 2 })
  ).toBeNull();
});

test.each(['fallback', 'stop'] as const)(
  'acknowledges %s after exhausting negotiation budget and restores relay',
  async (type) => {
    const { runtime, sender, receiver, session } = await prepared();
    await runtime.init();
    const transport = await runtime.getRouter().createDirectTransport();
    const producer = await transport.produce({
      kind: 'video',
      rtpParameters: {
        codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000 }],
        encodings: [{ ssrc: 8822 }]
      }
    });
    runtime.addProducer(1, StreamKind.SCREEN, producer);
    await sender.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: offer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: answer
    });
    await receiver.voice.signalDirectMedia({
      sessionId: session.sessionId,
      signal: { type: 'ready' }
    });
    expect(runtime.getRemoteIds(2).remoteScreenIds).toEqual([]);
    for (
      let index = 0;
      index < config.rateLimiters.voiceStream.maxRequests;
      index++
    ) {
      await expect(
        receiver.voice.signalDirectMedia({
          sessionId: crypto.randomUUID(),
          signal: offer
        })
      ).rejects.toThrow(/Direct screen session not found|Too many requests/);
    }
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: crypto.randomUUID(),
        signal: offer
      })
    ).rejects.toThrow('Too many requests');
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type, extra: true } as never
      })
    ).rejects.toThrow('Too many requests');
    expect(runtime.getDirectMediaSession(session.sessionId, 1)?.phase).toBe(
      'ready'
    );
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type }
      })
    ).resolves.toBeUndefined();
    expect(runtime.getDirectMediaSession(session.sessionId, 1)).toBeUndefined();
    expect(runtime.getRemoteIds(2).remoteScreenIds).toEqual([1]);
    const relay = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: runtime.getRouter().rtpCapabilities
    });
    runtime.addConsumer(2, 1, StreamKind.SCREEN, relay);
    expect(runtime.getRelayDemand(1)).toContainEqual({
      channelId: 2,
      kind: StreamKind.SCREEN,
      required: true
    });
    await expect(
      receiver.voice.signalDirectMedia({
        sessionId: session.sessionId,
        signal: { type }
      })
    ).resolves.toBeUndefined();
    transport.close();
  }
);
