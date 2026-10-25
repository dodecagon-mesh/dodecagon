import { ServerEvents, StreamKind } from '@dodecagon/shared';
import { describe, expect, test } from 'bun:test';
import type { Consumer, Producer } from 'mediasoup/types';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { config } from '../../config';
import { eventBus } from '../../plugins/event-bus';
import { pubsub } from '../../utils/pubsub';
import { EXTERNAL_STREAM_ID_BASE, VoiceRuntime } from '../voice';

type TCloseHandler = () => void;

let nextProducerId = 0;

const createProducerStub = () => {
  const handlers: TCloseHandler[] = [];

  const stub = {
    id: `producer-${nextProducerId++}`,
    closed: false,
    paused: false,
    kind: 'audio',
    observer: {
      on: (event: string, handler: TCloseHandler) => {
        if (event === 'close') handlers.push(handler);
      }
    },
    close: () => {
      stub.closed = true;
      handlers.forEach((handler) => handler());
    }
  };

  return stub;
};

const createConsumerStub = (producerId = 'producer-0') => {
  const stub = createProducerStub();

  return Object.assign(stub, {
    producerId,
    paused: false,
    producerPaused: false
  });
};

let nextChannelId = 9000;

const createRuntime = () => new VoiceRuntime(nextChannelId++);

describe('VoiceRuntime destroy', () => {
  test('should announce the users still in the channel', async () => {
    const runtime = createRuntime();

    runtime.addUser(
      7,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(7)
    );
    runtime.addUser(
      8,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(8)
    );

    const left: number[] = [];

    const subscription = pubsub
      .subscribe(ServerEvents.USER_LEAVE_VOICE)
      .subscribe({
        next: ({ userId, channelId }) => {
          if (channelId === runtime.id) left.push(userId);
        }
      });

    await runtime.destroy();

    subscription.unsubscribe();

    expect(left.sort()).toEqual([7, 8]);
    expect(runtime.getState().users).toEqual([]);
  });
});

describe('VoiceRuntime producer and consumer maps', () => {
  test('should close the previous producer when one replaces it', () => {
    const runtime = createRuntime();
    const first = createProducerStub();
    const second = createProducerStub();

    runtime.addProducer(1, StreamKind.AUDIO, first as unknown as Producer);
    runtime.addProducer(1, StreamKind.AUDIO, second as unknown as Producer);

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(runtime.getProducer(StreamKind.AUDIO, 1)).toBe(
      second as unknown as Producer
    );
  });

  test('should keep producers of other kinds when one is replaced', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    const audio = createProducerStub();
    const screenAudio = createProducerStub();
    const replacement = createProducerStub();

    try {
      runtime.addProducer(1, StreamKind.AUDIO, audio as unknown as Producer);
      runtime.addProducer(
        1,
        StreamKind.SCREEN_AUDIO,
        screenAudio as unknown as Producer
      );
      runtime.addProducer(
        1,
        StreamKind.AUDIO,
        replacement as unknown as Producer
      );

      expect(screenAudio.closed).toBe(false);
      expect(runtime.getProducer(StreamKind.SCREEN_AUDIO, 1)).toBe(
        screenAudio as unknown as Producer
      );
    } finally {
      await runtime.destroy();
    }
  });

  test('should close the previous consumer when one replaces it', () => {
    const runtime = createRuntime();
    const first = createConsumerStub();
    const second = createConsumerStub();

    runtime.addConsumer(1, 2, StreamKind.AUDIO, first as unknown as Consumer);
    runtime.addConsumer(1, 2, StreamKind.AUDIO, second as unknown as Consumer);

    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
  });

  test('should not let a replaced consumer evict the live one on close', () => {
    const runtime = createRuntime();
    const first = createConsumerStub();
    const second = createConsumerStub();

    runtime.addConsumer(1, 2, StreamKind.AUDIO, first as unknown as Consumer);
    runtime.addConsumer(1, 2, StreamKind.AUDIO, second as unknown as Consumer);

    // the orphan dying later must not remove the entry that replaced it
    first.close();

    expect(runtime.getConsumer(1, 2, StreamKind.AUDIO)).toBe(
      second as unknown as Consumer
    );
  });
});

describe('VoiceRuntime external streams', () => {
  // the id reaches clients in the same field as a user id, and anything that reads
  // one as the other drops the stream for exactly the user whose id matched: the
  // music that played for everyone else. so the two ranges cannot overlap
  test('should hand out ids that cannot collide with user ids', () => {
    const runtime = createRuntime();

    const first = runtime.createExternalStream({
      title: 'First',
      key: 'first',
      pluginId: 'music-bot',
      producers: { audio: createProducerStub() as unknown as Producer }
    });

    const second = runtime.createExternalStream({
      title: 'Second',
      key: 'second',
      pluginId: 'music-bot',
      producers: { audio: createProducerStub() as unknown as Producer }
    });

    expect(first).toBe(EXTERNAL_STREAM_ID_BASE);
    expect(second).toBe(EXTERNAL_STREAM_ID_BASE + 1);
  });

  test('should expose a new stream to the joining snapshot', () => {
    const runtime = createRuntime();

    const streamId = runtime.createExternalStream({
      title: 'Music',
      key: 'music',
      pluginId: 'music-bot',
      producers: { audio: createProducerStub() as unknown as Producer }
    });

    expect(runtime.getRemoteIds(1).remoteExternalStreamIds).toEqual([streamId]);
  });
});

describe('VoiceRuntime screen viewers', () => {
  test('counts active screen video consumers once and excludes the presenter', async () => {
    const runtime = createRuntime();
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
    const screen = createProducerStub();
    const viewer = createConsumerStub(screen.id);
    const self = createConsumerStub(screen.id);
    const audio = createConsumerStub(screen.id);

    runtime.addProducer(2, StreamKind.SCREEN, screen as unknown as Producer);
    runtime.addConsumer(1, 2, StreamKind.SCREEN, viewer as unknown as Consumer);
    runtime.addConsumer(2, 2, StreamKind.SCREEN, self as unknown as Consumer);
    runtime.addConsumer(
      1,
      2,
      StreamKind.SCREEN_AUDIO,
      audio as unknown as Consumer
    );

    expect(runtime.getScreenViewers()).toEqual({
      channelId: runtime.id,
      demos: {
        2: { producerId: screen.id, viewerIds: [1] }
      }
    });

    viewer.paused = true;
    expect(runtime.getScreenViewers().demos[2]!.viewerIds).toEqual([]);

    viewer.paused = false;
    viewer.producerPaused = true;
    expect(runtime.getScreenViewers().demos[2]!.viewerIds).toEqual([]);

    viewer.producerPaused = false;
    viewer.close();
    expect(runtime.getScreenViewers().demos[2]!.viewerIds).toEqual([]);

    await runtime.destroy();
  });

  test('keeps independent presenters independent', async () => {
    const runtime = createRuntime();
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
    runtime.addUser(
      3,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(3)
    );
    const first = createProducerStub();
    const second = createProducerStub();

    runtime.addProducer(1, StreamKind.SCREEN, first as unknown as Producer);
    runtime.addProducer(2, StreamKind.SCREEN, second as unknown as Producer);
    runtime.addConsumer(
      2,
      1,
      StreamKind.SCREEN,
      createConsumerStub(first.id) as unknown as Consumer
    );
    runtime.addConsumer(
      3,
      2,
      StreamKind.SCREEN,
      createConsumerStub(second.id) as unknown as Consumer
    );

    expect(runtime.getScreenViewers().demos).toEqual({
      1: { producerId: first.id, viewerIds: [2] },
      2: { producerId: second.id, viewerIds: [3] }
    });

    await runtime.destroy();
  });

  test('a ready direct session counts once and cannot outlive its producer', async () => {
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    const runtime = createRuntime();
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
    const screen = createProducerStub();
    runtime.addProducer(2, StreamKind.SCREEN, screen as unknown as Producer);
    runtime.registerDirectMediaSubscriber(1, true);
    runtime.registerDirectMediaSubscriber(2, true);

    try {
      const session = runtime.startDirectMedia(2, StreamKind.SCREEN, 1);
      expect(session).not.toBeNull();
      runtime.signalDirectMedia(session!.sessionId, 2, {
        type: 'offer',
        publicKey: 'a'.repeat(64),
        sdp: 'v=0\r\n'
      });
      runtime.signalDirectMedia(session!.sessionId, 1, {
        type: 'answer',
        publicKey: 'b'.repeat(64),
        sdp: 'v=0\r\n'
      });
      runtime.signalDirectMedia(session!.sessionId, 1, { type: 'ready' });

      expect(runtime.getScreenViewers().demos[2]!.viewerIds).toEqual([1]);

      const replacement = createProducerStub();
      runtime.addProducer(
        2,
        StreamKind.SCREEN,
        replacement as unknown as Producer
      );
      expect(
        runtime.getDirectMediaSession(session!.sessionId, 1)
      ).toBeUndefined();
      runtime.addConsumer(
        1,
        2,
        StreamKind.SCREEN,
        createConsumerStub(replacement.id) as unknown as Consumer
      );
      expect(runtime.getScreenViewers().demos[2]).toEqual({
        producerId: replacement.id,
        viewerIds: [1]
      });
    } finally {
      config.webRtc.holepunchMediaEnabled = previous;
      runtime.removeUser(1);
      runtime.removeUser(2);
      await runtime.destroy();
    }
  });

  test('publishes a change when screen consumption and production change', async () => {
    const runtime = createRuntime();
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
    const screen = createProducerStub();
    const events: number[] = [];
    const subscription = pubsub
      .subscribe(ServerEvents.VOICE_SCREEN_VIEWERS_CHANGED)
      .subscribe({ next: ({ channelId }) => events.push(channelId) });

    try {
      runtime.addProducer(2, StreamKind.SCREEN, screen as unknown as Producer);
      const consumer = createConsumerStub(screen.id);
      runtime.addConsumer(
        1,
        2,
        StreamKind.SCREEN,
        consumer as unknown as Consumer
      );
      consumer.close();

      expect(events).toEqual([runtime.id, runtime.id, runtime.id]);
    } finally {
      subscription.unsubscribe();
      await runtime.destroy();
    }
  });
});

describe('VoiceRuntime producer listing', () => {
  test('should list every kind with the id a consumer needs', () => {
    const runtime = createRuntime();
    runtime.addUser(
      2,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(2)
    );
    const audio = createProducerStub();
    const screen = createProducerStub();

    runtime.addProducer(1, StreamKind.AUDIO, audio as unknown as Producer);
    runtime.addProducer(2, StreamKind.SCREEN, screen as unknown as Producer);

    expect(runtime.listProducers()).toEqual([
      {
        userId: 1,
        kind: StreamKind.AUDIO,
        producerId: audio.id,
        paused: false
      },
      {
        userId: 2,
        kind: StreamKind.SCREEN,
        producerId: screen.id,
        paused: false
      }
    ]);
  });

  test('should drop a producer that closed', () => {
    const runtime = createRuntime();
    const audio = createProducerStub();

    runtime.addProducer(1, StreamKind.AUDIO, audio as unknown as Producer);
    runtime.removeProducer(1, StreamKind.AUDIO);

    expect(runtime.listProducers()).toEqual([]);
  });

  // external streams belong to a plugin and have no user behind them
  test('should leave external streams out', () => {
    const runtime = createRuntime();

    runtime.createExternalStream({
      title: 'Radio',
      key: 'radio',
      pluginId: 'plugin-a',
      producers: { audio: createProducerStub() as unknown as Producer }
    });

    expect(runtime.listProducers()).toEqual([]);
  });
});

describe('VoiceRuntime producer events', () => {
  const listen = (event: 'voice:producer_added' | 'voice:producer_removed') => {
    const seen: unknown[] = [];

    const unregister = eventBus.register('test-plugin', event, (payload) => {
      seen.push(payload);
    });

    return { seen, unregister };
  };

  test('should announce a producer that arrives', async () => {
    const runtime = createRuntime();
    const producer = createProducerStub();
    const { seen, unregister } = listen('voice:producer_added');

    runtime.addProducer(3, StreamKind.AUDIO, producer as unknown as Producer);

    await Bun.sleep(0);
    unregister();

    expect(seen).toEqual([
      {
        channelId: runtime.id,
        userId: 3,
        kind: StreamKind.AUDIO,
        producerId: producer.id
      }
    ]);
  });

  test('should announce a producer that ends', async () => {
    const runtime = createRuntime();
    const producer = createProducerStub();

    runtime.addProducer(3, StreamKind.AUDIO, producer as unknown as Producer);

    const { seen, unregister } = listen('voice:producer_removed');

    runtime.removeProducer(3, StreamKind.AUDIO);

    await Bun.sleep(0);
    unregister();

    expect(seen).toEqual([
      {
        channelId: runtime.id,
        userId: 3,
        kind: StreamKind.AUDIO,
        producerId: producer.id
      }
    ]);
  });

  // the close observer is the only path, so a replacement has to report the
  // producer it replaced rather than the new one
  test('should announce the replaced producer when one takes over', async () => {
    const runtime = createRuntime();
    const first = createProducerStub();
    const second = createProducerStub();

    runtime.addProducer(3, StreamKind.AUDIO, first as unknown as Producer);

    const { seen, unregister } = listen('voice:producer_removed');

    runtime.addProducer(3, StreamKind.AUDIO, second as unknown as Producer);

    await Bun.sleep(0);
    unregister();

    expect(seen).toEqual([
      {
        channelId: runtime.id,
        userId: 3,
        kind: StreamKind.AUDIO,
        producerId: first.id
      }
    ]);
  });
});

describe('VoiceRuntime voice-only mode', () => {
  test('closes non-microphone media without changing microphone or sound state', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: true, soundMuted: true },
      getTestVoiceConnection(1)
    );
    const microphone = createProducerStub();
    const voice = createConsumerStub();
    const mediaKinds = [
      StreamKind.VIDEO,
      StreamKind.SCREEN,
      StreamKind.SCREEN_AUDIO
    ];
    const producers = mediaKinds.map(() => createProducerStub());
    const consumerKinds = [
      ...mediaKinds,
      StreamKind.EXTERNAL_AUDIO,
      StreamKind.EXTERNAL_VIDEO
    ];
    const consumers = consumerKinds.map(() => createConsumerStub());
    runtime.addProducer(1, StreamKind.AUDIO, microphone as unknown as Producer);
    runtime.addConsumer(1, 2, StreamKind.AUDIO, voice as unknown as Consumer);
    mediaKinds.forEach((kind, index) => {
      runtime.addProducer(1, kind, producers[index] as unknown as Producer);
    });
    consumerKinds.forEach((kind, index) => {
      runtime.addConsumer(1, 2, kind, consumers[index] as unknown as Consumer);
    });

    try {
      runtime.updateUserState(1, {
        voiceOnlyMode: true,
        webcamEnabled: true,
        sharingScreen: true
      });
      expect(runtime.getUserState(1)).toMatchObject({
        voiceOnlyMode: true,
        micMuted: true,
        soundMuted: true,
        webcamEnabled: false,
        sharingScreen: false
      });
      expect(microphone.closed).toBe(false);
      expect(voice.closed).toBe(false);
      expect(runtime.getConsumer(1, 2, StreamKind.AUDIO)).toBe(
        voice as unknown as Consumer
      );
      producers.forEach((producer) => expect(producer.closed).toBe(true));
      consumers.forEach((consumer, index) => {
        expect(consumer.closed).toBe(true);
        expect(
          runtime.getConsumer(1, 2, consumerKinds[index]!)
        ).toBeUndefined();
      });
      runtime.updateUserState(1, { webcamEnabled: true, sharingScreen: true });
      expect(runtime.getUserState(1)).toMatchObject({
        webcamEnabled: false,
        sharingScreen: false
      });
      runtime.updateUserState(1, { voiceOnlyMode: undefined, micMuted: false });
      expect(runtime.getUserState(1)).toMatchObject({
        voiceOnlyMode: true,
        micMuted: false,
        soundMuted: true
      });
      expect(() => runtime.assertMediaAllowed(1, StreamKind.SCREEN)).toThrow();
    } finally {
      await runtime.destroy();
    }
  });

  test('rejects non-microphone attachments and accepts them again when disabled', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    runtime.updateUserState(1, { voiceOnlyMode: true });
    try {
      for (const kind of [
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO,
        StreamKind.EXTERNAL_VIDEO,
        StreamKind.EXTERNAL_AUDIO
      ]) {
        const consumer = createConsumerStub();
        expect(() =>
          runtime.addConsumer(1, 2, kind, consumer as unknown as Consumer)
        ).toThrow('Voice-only mode');
        expect(consumer.closed).toBe(true);
        expect(runtime.getConsumer(1, 2, kind)).toBeUndefined();
      }
      for (const kind of [
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ]) {
        const producer = createProducerStub();
        expect(() =>
          runtime.addProducer(1, kind, producer as unknown as Producer)
        ).toThrow('Voice-only mode');
        expect(producer.closed).toBe(true);
        expect(runtime.getProducer(kind, 1)).toBeUndefined();
      }
      const microphone = createProducerStub();
      runtime.addProducer(
        1,
        StreamKind.AUDIO,
        microphone as unknown as Producer
      );
      expect(microphone.closed).toBe(false);
      runtime.updateUserState(1, { voiceOnlyMode: false });
      const screen = createProducerStub();
      const externalAudio = createConsumerStub();
      runtime.addProducer(1, StreamKind.SCREEN, screen as unknown as Producer);
      runtime.addConsumer(
        1,
        2,
        StreamKind.EXTERNAL_AUDIO,
        externalAudio as unknown as Consumer
      );
      expect(screen.closed).toBe(false);
      expect(externalAudio.closed).toBe(false);
    } finally {
      await runtime.destroy();
    }
  });

  test('closes stale native resources even after voice-only mode is disabled again', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    const generation = runtime.getNonVoiceMediaGeneration(1);
    runtime.updateUserState(1, { voiceOnlyMode: true });
    runtime.updateUserState(1, { voiceOnlyMode: false });
    const producer = createProducerStub();
    const consumer = createConsumerStub();
    try {
      expect(() =>
        runtime.addProducer(
          1,
          StreamKind.SCREEN,
          producer as unknown as Producer,
          undefined,
          generation
        )
      ).toThrow('Voice-only mode');
      expect(() =>
        runtime.addConsumer(
          1,
          2,
          StreamKind.EXTERNAL_AUDIO,
          consumer as unknown as Consumer,
          generation
        )
      ).toThrow('Voice-only mode');
      expect(producer.closed).toBe(true);
      expect(consumer.closed).toBe(true);
      expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBeUndefined();
      expect(
        runtime.getConsumer(1, 2, StreamKind.EXTERNAL_AUDIO)
      ).toBeUndefined();
    } finally {
      await runtime.destroy();
    }
  });

  test('rejects nonvoice attachments after departure even without a captured token', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    runtime.removeUser(1);
    const producer = createProducerStub();
    const consumer = createConsumerStub();
    try {
      expect(() =>
        runtime.addProducer(
          1,
          StreamKind.SCREEN,
          producer as unknown as Producer
        )
      ).toThrow('Voice-only mode');
      expect(() =>
        runtime.addConsumer(
          1,
          2,
          StreamKind.EXTERNAL_AUDIO,
          consumer as unknown as Consumer
        )
      ).toThrow('Voice-only mode');
      expect(producer.closed).toBe(true);
      expect(consumer.closed).toBe(true);
      expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBeUndefined();
      expect(
        runtime.getConsumer(1, 2, StreamKind.EXTERNAL_AUDIO)
      ).toBeUndefined();
    } finally {
      await runtime.destroy();
    }
  });

  test('never lets a departed membership replace a rejoined users media', async () => {
    const runtime = createRuntime();
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    const departedGeneration = runtime.getNonVoiceMediaGeneration(1);
    runtime.removeUser(1);
    runtime.addUser(
      2,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(2)
    );
    const otherGeneration = runtime.getNonVoiceMediaGeneration(2);
    runtime.addUser(
      1,
      { micMuted: false, soundMuted: false },
      getTestVoiceConnection(1)
    );
    const currentGeneration = runtime.getNonVoiceMediaGeneration(1);
    const producer = createProducerStub();
    const consumer = createConsumerStub();
    const staleProducer = createProducerStub();
    const staleConsumer = createConsumerStub();
    try {
      expect(currentGeneration).toBeGreaterThan(departedGeneration);
      expect(currentGeneration).toBeGreaterThan(otherGeneration);
      runtime.addProducer(
        1,
        StreamKind.SCREEN,
        producer as unknown as Producer,
        undefined,
        currentGeneration
      );
      runtime.addConsumer(
        1,
        2,
        StreamKind.EXTERNAL_AUDIO,
        consumer as unknown as Consumer,
        currentGeneration
      );
      expect(() =>
        runtime.addProducer(
          1,
          StreamKind.SCREEN,
          staleProducer as unknown as Producer,
          undefined,
          departedGeneration
        )
      ).toThrow('Voice-only mode');
      expect(() =>
        runtime.addConsumer(
          1,
          2,
          StreamKind.EXTERNAL_AUDIO,
          staleConsumer as unknown as Consumer,
          departedGeneration
        )
      ).toThrow('Voice-only mode');
      expect(staleProducer.closed).toBe(true);
      expect(staleConsumer.closed).toBe(true);
      expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBe(
        producer as unknown as Producer
      );
      expect(runtime.getConsumer(1, 2, StreamKind.EXTERNAL_AUDIO)).toBe(
        consumer as unknown as Consumer
      );
      expect(producer.closed).toBe(false);
      expect(consumer.closed).toBe(false);
    } finally {
      await runtime.destroy();
    }
  });
});

describe('VoiceRuntime direct media fallback', () => {
  test('keeps relay producers visible while both participants support direct media', async () => {
    const runtime = createRuntime();
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
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    try {
      runtime.registerDirectMediaSubscriber(1, true);
      runtime.registerDirectMediaSubscriber(2, true);
      const relayProducer = createProducerStub();
      runtime.addProducer(
        2,
        StreamKind.AUDIO,
        relayProducer as unknown as Producer
      );

      expect(runtime.hasDirectMediaCapability(2, StreamKind.AUDIO)).toBe(true);
      expect(runtime.getRemoteIds(1).remoteAudioIds).toEqual([2]);
      expect(relayProducer.closed).toBe(false);
    } finally {
      config.webRtc.holepunchMediaEnabled = previous;
      await runtime.destroy();
    }
  });

  test('a failed attempt latches only its pair without disabling native capability', async () => {
    const runtime = createRuntime();
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
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    const updates: number[] = [];
    const signals: { userId: number; relayAllowed: boolean }[] = [];
    const stateSubscription = pubsub
      .subscribe(ServerEvents.USER_VOICE_STATE_UPDATE)
      .subscribe({
        next: ({ userId, channelId }) => {
          if (channelId === runtime.id) updates.push(userId);
        }
      });
    const senderSignal = pubsub
      .subscribeFor(1, ServerEvents.DIRECT_MEDIA_SIGNAL)
      .subscribe({
        next: (event) => signals.push({ userId: 1, ...event })
      });
    const peerSignal = pubsub
      .subscribeFor(2, ServerEvents.DIRECT_MEDIA_SIGNAL)
      .subscribe({
        next: (event) => signals.push({ userId: 2, ...event })
      });
    try {
      runtime.registerDirectMediaSubscriber(1, true);
      runtime.registerDirectMediaSubscriber(2, true);
      const session = runtime.startDirectMedia(1, StreamKind.AUDIO, 2);
      expect(session).not.toBeNull();

      runtime.signalDirectMedia(session!.sessionId, 1, { type: 'fallback' });

      expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
      expect(runtime.getUserState(2).directMediaEnabled).toBe(true);
      expect(runtime.hasDirectMediaCapability(1, StreamKind.AUDIO)).toBe(true);
      expect(runtime.startDirectMedia(1, StreamKind.AUDIO, 2)).toBeNull();
      const nextPublication = createProducerStub();
      runtime.addProducer(
        1,
        StreamKind.AUDIO,
        nextPublication as unknown as Producer
      );
      expect(runtime.startDirectMedia(1, StreamKind.AUDIO, 2)).not.toBeNull();
      expect(updates).toEqual(expect.arrayContaining([1, 2]));
      expect(signals).toHaveLength(2);
      signals.forEach((signal) => expect(signal.relayAllowed).toBe(true));
    } finally {
      stateSubscription.unsubscribe();
      senderSignal.unsubscribe();
      peerSignal.unsubscribe();
      config.webRtc.holepunchMediaEnabled = previous;
      await runtime.destroy();
    }
  });

  test('the feature flag disables direct while relay stays usable', async () => {
    const runtime = createRuntime();
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
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = false;
    try {
      runtime.registerDirectMediaSubscriber(1, true);
      runtime.registerDirectMediaSubscriber(2, true);
      const relayProducer = createProducerStub();
      runtime.addProducer(
        2,
        StreamKind.AUDIO,
        relayProducer as unknown as Producer
      );

      expect(runtime.getUserState(1).directMediaEnabled).toBe(false);
      expect(runtime.startDirectMedia(1, StreamKind.AUDIO, 2)).toBeNull();
      expect(runtime.getRemoteIds(1).remoteAudioIds).toEqual([2]);
    } finally {
      config.webRtc.holepunchMediaEnabled = previous;
      await runtime.destroy();
    }
  });
});

describe('VoiceRuntime relay during a direct attempt', () => {
  test('a standby relay producer preserves an in-flight direct session', async () => {
    const runtime = createRuntime();
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
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    try {
      runtime.registerDirectMediaSubscriber(1, true);
      runtime.registerDirectMediaSubscriber(2, true);
      const session = runtime.startDirectMedia(1, StreamKind.AUDIO, 2);
      expect(session).not.toBeNull();

      const relayProducer = createProducerStub();
      runtime.addProducer(
        1,
        StreamKind.AUDIO,
        relayProducer as unknown as Producer
      );

      expect(relayProducer.closed).toBe(false);
      expect(runtime.getUserState(1).directMediaEnabled).toBe(true);
      expect(runtime.getUserState(2).directMediaEnabled).toBe(true);
      expect(
        runtime.getDirectMediaSession(session!.sessionId, 1)
      ).toBeDefined();
      expect(runtime.getRemoteIds(2).remoteAudioIds).toEqual([1]);
    } finally {
      config.webRtc.holepunchMediaEnabled = previous;
      await runtime.destroy();
    }
  });
});

test.each([StreamKind.AUDIO, StreamKind.VIDEO, StreamKind.SCREEN])(
  'a ready %s path rejects late relay consumers and ends with its source',
  async (kind) => {
    const previous = config.webRtc.holepunchMediaEnabled;
    config.webRtc.holepunchMediaEnabled = true;
    const runtime = createRuntime();
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
    runtime.registerDirectMediaSubscriber(1, true);
    runtime.registerDirectMediaSubscriber(2, true);
    const producer = createProducerStub();
    runtime.addProducer(1, kind, producer as unknown as Producer);
    const screenAudio = createProducerStub();
    const screenAudioConsumer = createConsumerStub(screenAudio.id);
    if (kind === StreamKind.SCREEN) {
      runtime.addProducer(
        1,
        StreamKind.SCREEN_AUDIO,
        screenAudio as unknown as Producer
      );
      runtime.addConsumer(
        2,
        1,
        StreamKind.SCREEN_AUDIO,
        screenAudioConsumer as unknown as Consumer
      );
    }
    try {
      const session = runtime.startDirectMedia(1, kind, 2)!;
      runtime.signalDirectMedia(session.sessionId, 1, {
        type: 'offer',
        sdp: 'v=0\r\n',
        publicKey: 'a'.repeat(64)
      });
      runtime.signalDirectMedia(session.sessionId, 2, {
        type: 'answer',
        sdp: 'v=0\r\n',
        publicKey: 'b'.repeat(64)
      });
      runtime.signalDirectMedia(session.sessionId, 2, { type: 'ready' });
      if (kind === StreamKind.SCREEN) {
        expect(screenAudioConsumer.closed).toBe(true);
        expect(screenAudio.closed).toBe(false);
        expect(runtime.getRemoteIds(2).remoteScreenAudioIds).toEqual([]);
      }
      const late = createConsumerStub(producer.id);
      expect(() =>
        runtime.addConsumer(2, 1, kind, late as unknown as Consumer)
      ).toThrow('This media is already delivered directly');
      expect(late.closed).toBe(true);
      producer.close();
      expect(
        runtime.getDirectMediaSession(session.sessionId, 1)
      ).toBeUndefined();
      expect(runtime.hasDirectMediaCapability(1, kind)).toBe(true);
    } finally {
      config.webRtc.holepunchMediaEnabled = previous;
      await runtime.destroy();
    }
  }
);
