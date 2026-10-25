import { StreamKind } from '@dodecagon/shared';
import { describe, expect, test } from 'bun:test';
import type { Consumer, Producer } from 'mediasoup/types';
import { createMockContext } from '../../__tests__/context';
import { getMockedToken, initTest } from '../../__tests__/helpers';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { appRouter } from '../../routers';
import { VoiceRuntime } from '../../runtimes/voice';

const createProducerStub = (id: string, kind: 'audio' | 'video' = 'video') => {
  const stub = {
    id,
    kind,
    closed: false,
    paused: false,
    observer: { on: () => {} },
    close: () => {
      stub.closed = true;
    }
  };

  return stub;
};

const createConsumerStub = (producerId: string) => {
  const stub = {
    id: `consumer-${producerId}`,
    producerId,
    closed: false,
    paused: false,
    producerPaused: false,
    observer: { on: () => {} },
    close: () => {
      stub.closed = true;
    }
  };

  return stub;
};

describe('voice.onScreenViewers', () => {
  test('delivers an initial snapshot and replaces it when consumption changes', async () => {
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
    const screen = createProducerStub('screen-2');
    runtime.addProducer(2, StreamKind.SCREEN, screen as unknown as Producer);
    const { caller } = await initTest(1);
    const snapshots: unknown[] = [];

    try {
      const observable = await caller.voice.onScreenViewers({ channelId: 2 });
      const subscription = observable.subscribe({
        next: (snapshot) => snapshots.push(snapshot)
      });

      expect(snapshots).toEqual([
        {
          channelId: 2,
          demos: {
            2: { producerId: screen.id, viewerIds: [] }
          }
        }
      ]);

      const consumer = createConsumerStub(screen.id);
      runtime.addConsumer(
        1,
        2,
        StreamKind.SCREEN,
        consumer as unknown as Consumer
      );

      expect(snapshots).toEqual([
        {
          channelId: 2,
          demos: {
            2: { producerId: screen.id, viewerIds: [] }
          }
        },
        {
          channelId: 2,
          demos: {
            2: { producerId: screen.id, viewerIds: [1] }
          }
        }
      ]);

      subscription.unsubscribe();
    } finally {
      await runtime.destroy();
    }
  });

  test('requires visibility and validates the channel id', async () => {
    const { caller } = await initTest(3);

    await expect(
      caller.voice.onScreenViewers({ channelId: 4 })
    ).rejects.toThrow('Insufficient channel permissions');
    await expect(
      caller.voice.onScreenViewers({ channelId: 0 })
    ).rejects.toThrow();
  });

  test('rejects an unauthenticated subscription', async () => {
    const context = await createMockContext({
      customToken: await getMockedToken(1)
    });
    const caller = appRouter.createCaller({
      ...context,
      authenticated: false
    });

    await expect(
      caller.voice.onScreenViewers({ channelId: 2 })
    ).rejects.toThrow('You must be authenticated');
  });
});
