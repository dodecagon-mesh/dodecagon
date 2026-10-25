import { Permission, ServerEvents, StreamKind } from '@dodecagon/shared';
import { describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import type { RtpParameters } from 'mediasoup/types';
import { createMockContext } from '../../__tests__/context';
import { getMockedToken, initTest } from '../../__tests__/helpers';
import { tdb } from '../../__tests__/setup';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { rolePermissions } from '../../db/schema';
import { VoiceRuntime } from '../../runtimes/voice';
import { pubsub } from '../../utils/pubsub';
import type { Context } from '../../utils/trpc';

const audioParameters: RtpParameters = {
  codecs: [
    {
      mimeType: 'audio/opus',
      payloadType: 100,
      clockRate: 48000,
      channels: 2
    }
  ],
  encodings: [{ ssrc: 35353535 }]
};

const screenParameters: RtpParameters = {
  codecs: [{ mimeType: 'video/VP8', payloadType: 101, clockRate: 90000 }],
  encodings: [{ ssrc: 45454545 }]
};

const join = async (overrides?: Partial<Context>, resume = true) => {
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
  await runtime.init();
  const { caller } = await initTest(1, undefined, {
    currentVoiceChannelId: 2,
    ...overrides
  });
  await runtime.createProducerTransport(2);
  const transport = runtime.getProducerTransport(2)!;
  await runtime.createConsumerTransport(1);
  const screen = await transport.produce({
    kind: 'video',
    rtpParameters: screenParameters
  });
  runtime.addProducer(2, StreamKind.SCREEN, screen);
  const input = {
    remoteId: 2,
    kind: StreamKind.SCREEN,
    rtpCapabilities: runtime.getRouter().rtpCapabilities
  };
  await caller.voice.consume(input);
  if (resume) {
    await caller.voice.resumeConsumer({
      remoteId: 2,
      kind: StreamKind.SCREEN,
      consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN)!.id
    });
  }
  return { runtime, caller, transport, screen, input };
};

const createPermissionGate = async () => {
  const context = await createMockContext({
    customToken: await getMockedToken(1)
  });
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let armed = false;
  const overrides: Partial<Context> = {
    needsPermission: async (permission) => {
      if (armed && permission === Permission.JOIN_VOICE_CHANNELS) {
        armed = false;
        entered.resolve();
        await released.promise;
      }
      await context.needsPermission(permission);
    }
  };
  return {
    overrides,
    entered: entered.promise,
    arm: () => {
      armed = true;
    },
    release: () => released.resolve()
  };
};

const controls: Array<'pauseConsumer' | 'resumeConsumer'> = [
  'pauseConsumer',
  'resumeConsumer'
];

// native transports exercise pause state; real websocket delivery is covered by browser smoke.
describe('screen consumer controls', () => {
  test('asks the presenter for a direct screen session when a viewer consumes', async () => {
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
    await runtime.init();
    const { caller } = await initTest(1, undefined, {
      currentVoiceChannelId: 2
    });
    await runtime.createProducerTransport(2);
    const transport = runtime.getProducerTransport(2)!;
    await runtime.createConsumerTransport(1);
    const screen = await transport.produce({
      kind: 'video',
      rtpParameters: screenParameters
    });
    runtime.addProducer(2, StreamKind.SCREEN, screen);
    const events: unknown[] = [];
    const observation = pubsub
      .subscribeFor(2, ServerEvents.VOICE_SCREEN_CONSUMER_STARTED)
      .subscribe({ next: (event) => events.push(event) });
    try {
      await caller.voice.consume({
        remoteId: 2,
        kind: StreamKind.SCREEN,
        rtpCapabilities: runtime.getRouter().rtpCapabilities
      });
      expect(events).toEqual([
        {
          channelId: 2,
          producerId: screen.id,
          peerId: 1
        }
      ]);
    } finally {
      observation.unsubscribe();
      await runtime.destroy();
    }
  });

  test('holds the first video keyframe until the receiving consumer is ready', async () => {
    const { runtime, caller } = await join(undefined, false);
    try {
      const consumer = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
      expect(consumer.paused).toBe(true);
      await caller.voice.resumeConsumer({
        remoteId: 2,
        kind: StreamKind.SCREEN,
        consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN)!.id
      });
      expect(consumer.paused).toBe(false);
    } finally {
      await runtime.destroy();
    }
  });

  test('a stale ready message cannot resume a replacement video consumer', async () => {
    const { runtime, caller, input } = await join(undefined, false);
    try {
      const previous = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
      await caller.voice.consume(input);
      const replacement = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
      await expect(
        caller.voice.resumeConsumer({
          remoteId: 2,
          kind: StreamKind.SCREEN,
          consumerId: previous.id
        })
      ).rejects.toThrow('Consumer not found');
      expect(replacement.paused).toBe(true);
    } finally {
      await runtime.destroy();
    }
  });

  test('pauses and resumes screen video and audio without changing microphone or presenter', async () => {
    const { runtime, caller, transport, screen } = await join();
    try {
      const screenAudio = await transport.produce({
        kind: 'audio',
        rtpParameters: audioParameters
      });
      runtime.addProducer(2, StreamKind.SCREEN_AUDIO, screenAudio);
      const microphone = await transport.produce({
        kind: 'audio',
        rtpParameters: {
          ...audioParameters,
          encodings: [{ ssrc: 56565656 }]
        }
      });
      runtime.addProducer(2, StreamKind.AUDIO, microphone);
      await caller.voice.consume({
        remoteId: 2,
        kind: StreamKind.SCREEN_AUDIO,
        rtpCapabilities: runtime.getRouter().rtpCapabilities
      });
      await caller.voice.consume({
        remoteId: 2,
        kind: StreamKind.AUDIO,
        rtpCapabilities: runtime.getRouter().rtpCapabilities
      });
      const screenConsumer = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
      const audioConsumer = runtime.getConsumer(1, 2, StreamKind.SCREEN_AUDIO)!;
      const microphoneConsumer = runtime.getConsumer(1, 2, StreamKind.AUDIO)!;
      await caller.voice.pauseConsumer({
        remoteId: 2,
        kind: StreamKind.SCREEN
      });
      await caller.voice.pauseConsumer({
        remoteId: 2,
        kind: StreamKind.SCREEN_AUDIO
      });
      expect(screenConsumer.paused).toBe(true);
      expect(audioConsumer.paused).toBe(true);
      expect(microphoneConsumer.paused).toBe(false);
      expect(screen.paused).toBe(false);
      expect(screenAudio.paused).toBe(false);
      await caller.voice.resumeConsumer({
        remoteId: 2,
        kind: StreamKind.SCREEN,
        consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN)!.id
      });
      await caller.voice.resumeConsumer({
        remoteId: 2,
        kind: StreamKind.SCREEN_AUDIO,
        consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN_AUDIO)!.id
      });
      expect(screenConsumer.paused).toBe(false);
      expect(audioConsumer.paused).toBe(false);
      expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)).toBe(screenConsumer);
      expect(runtime.getConsumer(1, 2, StreamKind.AUDIO)).toBe(
        microphoneConsumer
      );
      expect(screen.closed).toBe(false);
      expect(screenAudio.closed).toBe(false);
    } finally {
      await runtime.destroy();
    }
  });

  test.each(controls)(
    '%s rejects missing global permission before runtime access',
    async (control) => {
      await tdb
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, 2),
            eq(rolePermissions.permission, Permission.JOIN_VOICE_CHANNELS)
          )
        );
      const { caller } = await initTest(2);
      await expect(
        caller.voice[control]({
          remoteId: 1,
          kind: StreamKind.SCREEN,
          consumerId: 'missing'
        })
      ).rejects.toThrow('Insufficient permissions');
    }
  );

  test.each(controls)('%s rejects a caller outside voice', async (control) => {
    const { caller } = await initTest(1);
    await expect(
      caller.voice[control]({
        remoteId: 2,
        kind: StreamKind.SCREEN,
        consumerId: 'missing'
      })
    ).rejects.toThrow('User is not in a voice channel');
  });

  test.each(controls)('%s rejects a missing runtime', async (control) => {
    const { caller } = await initTest(1, undefined, {
      currentVoiceChannelId: 2
    });
    await expect(
      caller.voice[control]({
        remoteId: 2,
        kind: StreamKind.SCREEN,
        consumerId: 'missing'
      })
    ).rejects.toThrow('Voice runtime not found for this channel');
  });

  test.each(controls)(
    '%s cannot control another viewer or an absent consumer',
    async (control) => {
      const { runtime, caller } = await join();
      try {
        const { caller: otherViewer } = await initTest(2, undefined, {
          currentVoiceChannelId: 2
        });
        await expect(
          otherViewer.voice[control]({
            remoteId: 2,
            kind: StreamKind.SCREEN,
            consumerId: 'missing'
          })
        ).rejects.toThrow('Consumer not found');
        await expect(
          caller.voice[control]({
            remoteId: 3,
            kind: StreamKind.SCREEN,
            consumerId: 'missing'
          })
        ).rejects.toThrow('Consumer not found');
        expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)!.paused).toBe(
          false
        );
      } finally {
        await runtime.destroy();
      }
    }
  );

  test.each(controls)(
    '%s validates remote identity and excludes microphone controls',
    async (control) => {
      const { runtime, caller } = await join();
      try {
        await expect(
          caller.voice[control]({
            remoteId: '2' as never,
            kind: StreamKind.SCREEN,
            consumerId: 'missing'
          })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
          caller.voice[control]({
            remoteId: 2,
            kind: StreamKind.AUDIO as never,
            consumerId: 'missing'
          })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)!.paused).toBe(
          false
        );
      } finally {
        await runtime.destroy();
      }
    }
  );

  test.each(controls)(
    '%s honors voice-only policy after it closes screen consumers',
    async (control) => {
      const { runtime, caller } = await join();
      try {
        const consumer = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
        await caller.voice.updateState({ voiceOnlyMode: true });
        await expect(
          caller.voice[control]({
            remoteId: 2,
            kind: StreamKind.SCREEN,
            consumerId: 'missing'
          })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(consumer.closed).toBe(true);
        expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)).toBeUndefined();
      } finally {
        await runtime.destroy();
      }
    }
  );

  for (const transition of ['mode cycle', 'leave and rejoin'] as const) {
    test.each(controls)(
      `late %s cannot mutate a replacement consumer after ${transition}`,
      async (control) => {
        const gate = await createPermissionGate();
        const { runtime, caller, input } = await join(gate.overrides);
        try {
          gate.arm();
          const pending = caller.voice[control]({
            remoteId: 2,
            kind: StreamKind.SCREEN,
            consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN)!.id
          });
          const rejected = pending.catch((error: unknown) => error);
          await gate.entered;
          if (transition === 'mode cycle') {
            await caller.voice.updateState({ voiceOnlyMode: true });
            await caller.voice.updateState({ voiceOnlyMode: false });
          } else {
            runtime.removeUser(1);
            runtime.addUser(
              1,
              { micMuted: false, soundMuted: false },
              getTestVoiceConnection(1)
            );
            await runtime.createConsumerTransport(1);
          }
          await caller.voice.consume(input);
          const replacement = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
          await caller.voice.resumeConsumer({
            remoteId: 2,
            kind: StreamKind.SCREEN,
            consumerId: runtime.getConsumer(1, 2, StreamKind.SCREEN)!.id
          });
          if (control === 'resumeConsumer') {
            await caller.voice.pauseConsumer({
              remoteId: 2,
              kind: StreamKind.SCREEN
            });
          }
          gate.release();
          const error = await rejected;
          expect(replacement.closed).toBe(false);
          expect(replacement.paused).toBe(control === 'resumeConsumer');
          expect(error).toMatchObject({
            code: transition === 'mode cycle' ? 'FORBIDDEN' : 'BAD_REQUEST'
          });
          expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)).toBe(
            replacement
          );
        } finally {
          gate.release();
          await runtime.destroy();
        }
      }
    );
  }
});
