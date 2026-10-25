import { ChannelPermission, Permission, StreamKind } from '@dodecagon/shared';
import { describe, expect, spyOn, test } from 'bun:test';
import type { Consumer, Producer, RtpParameters } from 'mediasoup/types';
import { createMockContext } from '../../__tests__/context';
import { getMockedToken, initTest } from '../../__tests__/helpers';
import { getTestVoiceConnection } from '../../__tests__/voice-connection';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { VoiceRuntime } from '../../runtimes/voice';
import { invariant } from '../../utils/invariant';
import type { Context } from '../../utils/trpc';

const audioParameters = (ssrc: number): RtpParameters => ({
  codecs: [
    {
      mimeType: 'audio/opus',
      payloadType: 100,
      clockRate: 48000,
      channels: 2
    }
  ],
  encodings: [{ ssrc }]
});

const videoParameters = (ssrc: number): RtpParameters => ({
  codecs: [{ mimeType: 'video/VP8', payloadType: 101, clockRate: 90000 }],
  encodings: [{ ssrc }]
});

const join = async (ctxOverrides?: Partial<Context>) => {
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
    ...ctxOverrides
  });
  await runtime.createProducerTransport(1);
  await runtime.createProducerTransport(2);
  await runtime.createConsumerTransport(1);
  return { runtime, caller };
};

const createPermissionGate = async (stage: 'join' | 'channel' | 'server') => {
  const context = await createMockContext({
    customToken: await getMockedToken(1)
  });
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let armed = false;

  const wait = async () => {
    if (!armed) return;
    armed = false;
    entered.resolve();
    await released.promise;
  };
  const overrides: Partial<Context> = {
    needsPermission: async (permission) => {
      if (
        (stage === 'join' && permission === Permission.JOIN_VOICE_CHANNELS) ||
        (stage === 'server' && permission === Permission.SHARE_SCREEN)
      ) {
        await wait();
      }
      await context.needsPermission(permission);
    },
    needsChannelPermission: async (channelId, permission) => {
      if (
        stage === 'channel' &&
        permission === ChannelPermission.SHARE_SCREEN
      ) {
        await wait();
      }
      await context.needsChannelPermission(channelId, permission);
    }
  };

  return {
    context: { ...context, ...overrides },
    overrides,
    entered: entered.promise,
    arm: () => {
      armed = true;
    },
    release: () => released.resolve()
  };
};

describe('voice-only media policy', () => {
  test('closes native nonvoice media, retains microphones and resumes remote media', async () => {
    const { runtime, caller } = await join();
    try {
      const transport = runtime.getProducerTransport(1)!;
      await caller.voice.produce({
        transportId: transport.id,
        kind: StreamKind.AUDIO,
        rtpParameters: audioParameters(11111111)
      });
      await caller.voice.produce({
        transportId: transport.id,
        kind: StreamKind.VIDEO,
        rtpParameters: videoParameters(22222222)
      });
      const microphone = runtime.getProducer(StreamKind.AUDIO, 1)!;
      const webcam = runtime.getProducer(StreamKind.VIDEO, 1)!;
      const remoteTransport = runtime.getProducerTransport(2)!;
      const remoteVoice = await remoteTransport.produce({
        kind: 'audio',
        rtpParameters: audioParameters(33333333)
      });
      const remoteScreen = await remoteTransport.produce({
        kind: 'video',
        rtpParameters: videoParameters(44444444)
      });
      const externalAudio = await remoteTransport.produce({
        kind: 'audio',
        rtpParameters: audioParameters(55555555)
      });
      runtime.addProducer(2, StreamKind.AUDIO, remoteVoice);
      runtime.addProducer(2, StreamKind.SCREEN, remoteScreen);
      const streamId = runtime.createExternalStream({
        title: 'Music',
        key: 'voice-only-test',
        pluginId: 'voice-only-test',
        producers: { audio: externalAudio }
      });
      const rtpCapabilities = runtime.getRouter().rtpCapabilities;
      await caller.voice.consume({
        kind: StreamKind.AUDIO,
        remoteId: 2,
        rtpCapabilities
      });
      await caller.voice.consume({
        kind: StreamKind.SCREEN,
        remoteId: 2,
        rtpCapabilities
      });
      await caller.voice.consume({
        kind: StreamKind.EXTERNAL_AUDIO,
        remoteId: streamId,
        rtpCapabilities
      });
      const voiceConsumer = runtime.getConsumer(1, 2, StreamKind.AUDIO)!;
      const screenConsumer = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
      const musicConsumer = runtime.getConsumer(
        1,
        streamId,
        StreamKind.EXTERNAL_AUDIO
      )!;
      await caller.voice.updateState({ voiceOnlyMode: true });
      expect(microphone.closed).toBe(false);
      expect(voiceConsumer.closed).toBe(false);
      expect(webcam.closed).toBe(true);
      expect(screenConsumer.closed).toBe(true);
      expect(musicConsumer.closed).toBe(true);
      expect(remoteScreen.closed).toBe(false);
      expect(externalAudio.closed).toBe(false);
      for (const kind of [
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO
      ] as const) {
        await expect(
          caller.voice.produce({
            transportId: transport.id,
            kind,
            rtpParameters:
              kind === StreamKind.SCREEN_AUDIO
                ? audioParameters(66666666)
                : videoParameters(66666666)
          })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      for (const [kind, remoteId] of [
        [StreamKind.SCREEN, 2],
        [StreamKind.EXTERNAL_AUDIO, streamId]
      ] as const) {
        await expect(
          caller.voice.consume({ kind, remoteId, rtpCapabilities })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      await caller.voice.updateState({ voiceOnlyMode: false });
      await caller.voice.consume({
        kind: StreamKind.SCREEN,
        remoteId: 2,
        rtpCapabilities
      });
      await caller.voice.consume({
        kind: StreamKind.EXTERNAL_AUDIO,
        remoteId: streamId,
        rtpCapabilities
      });
      expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)?.closed).toBe(false);
      expect(
        runtime.getConsumer(1, streamId, StreamKind.EXTERNAL_AUDIO)?.closed
      ).toBe(false);
      expect(runtime.getProducer(StreamKind.VIDEO, 1)).toBeUndefined();
      expect(runtime.getProducer(StreamKind.AUDIO, 1)).toBe(microphone);
      expect(runtime.getConsumer(1, 2, StreamKind.AUDIO)).toBe(voiceConsumer);
    } finally {
      await runtime.destroy();
    }
  });

  test.each(['mode cycle', 'leave and rejoin'] as const)(
    'keeps resumed native consumption after %s while an older permission check completes',
    async (transition) => {
      const gate = await createPermissionGate('join');
      const { runtime, caller } = await join(gate.overrides);
      try {
        const screen = await runtime.getProducerTransport(2)!.produce({
          kind: 'video',
          rtpParameters: videoParameters(71717171)
        });
        runtime.addProducer(2, StreamKind.SCREEN, screen);
        const input = {
          kind: StreamKind.SCREEN,
          remoteId: 2,
          rtpCapabilities: runtime.getRouter().rtpCapabilities
        };
        gate.arm();
        const pending = caller.voice.consume(input);
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
        const resumed = await caller.voice.consume(input);
        const consumer = runtime.getConsumer(1, 2, StreamKind.SCREEN)!;
        expect(consumer.id).toBe(resumed.consumerId);
        expect(consumer.closed).toBe(false);
        gate.release();
        expect(await rejected).toMatchObject({
          code: transition === 'mode cycle' ? 'FORBIDDEN' : 'BAD_REQUEST'
        });
        expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)).toBe(consumer);
        expect(consumer.closed).toBe(false);
      } finally {
        gate.release();
        await runtime.destroy();
      }
    }
  );

  test.each(['join', 'channel', 'server'] as const)(
    'rejects stale native production spanning the %s permission check',
    async (stage) => {
      const gate = await createPermissionGate(stage);
      const { runtime, caller } = await join(gate.overrides);
      try {
        gate.arm();
        const pending = caller.voice.produce({
          transportId: runtime.getProducerTransport(1)!.id,
          kind: StreamKind.SCREEN,
          rtpParameters: videoParameters(72727272)
        });
        const rejected = pending.catch((error: unknown) => error);
        await gate.entered;
        await caller.voice.updateState({ voiceOnlyMode: true });
        await caller.voice.updateState({ voiceOnlyMode: false });
        gate.release();
        expect(await rejected).toMatchObject({ code: 'FORBIDDEN' });
        expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBeUndefined();
        expect(runtime.listProducers()).toEqual([]);
      } finally {
        gate.release();
        await runtime.destroy();
      }
    }
  );

  test('closes native production that completes after mode is enabled then disabled', async () => {
    const { runtime, caller } = await join();
    const transport = runtime.getProducerTransport(1)!;
    const produce = transport.produce.bind(transport);
    let lateProducer: Producer | undefined;
    const boundary = spyOn(transport, 'produce').mockImplementation(
      async (options) => {
        const producer = await produce(options);
        lateProducer = producer;
        runtime.updateUserState(1, { voiceOnlyMode: true });
        runtime.updateUserState(1, { voiceOnlyMode: false });
        return producer;
      }
    );
    try {
      await expect(
        caller.voice.produce({
          transportId: transport.id,
          kind: StreamKind.SCREEN,
          rtpParameters: videoParameters(77777777)
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(lateProducer?.closed).toBe(true);
      expect(runtime.getProducer(StreamKind.SCREEN, 1)).toBeUndefined();
    } finally {
      boundary.mockRestore();
      await runtime.destroy();
    }
  });

  test('closes native consumption that completes after mode is enabled then disabled', async () => {
    const { runtime, caller } = await join();
    const transport = runtime.getConsumerTransport(1)!;
    const consume = transport.consume.bind(transport);
    let lateConsumer: Consumer | undefined;
    try {
      const screen = await runtime.getProducerTransport(2)!.produce({
        kind: 'video',
        rtpParameters: videoParameters(88888888)
      });
      runtime.addProducer(2, StreamKind.SCREEN, screen);
      const boundary = spyOn(transport, 'consume').mockImplementation(
        async (options) => {
          const consumer = await consume(options);
          lateConsumer = consumer;
          runtime.updateUserState(1, { voiceOnlyMode: true });
          runtime.updateUserState(1, { voiceOnlyMode: false });
          return consumer;
        }
      );
      try {
        await expect(
          caller.voice.consume({
            kind: StreamKind.SCREEN,
            remoteId: 2,
            rtpCapabilities: runtime.getRouter().rtpCapabilities
          })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(lateConsumer?.closed).toBe(true);
        expect(runtime.getConsumer(1, 2, StreamKind.SCREEN)).toBeUndefined();
      } finally {
        boundary.mockRestore();
      }
    } finally {
      await runtime.destroy();
    }
  });

  test('rejects nonboolean mode updates without changing active policy', async () => {
    const { runtime, caller } = await join();
    try {
      await caller.voice.updateState({ voiceOnlyMode: true });
      await expect(
        caller.voice.updateState({ voiceOnlyMode: 'false' as never })
      ).rejects.toThrow();
      expect(runtime.getUserState(1).voiceOnlyMode).toBe(true);
    } finally {
      await runtime.destroy();
    }
  });
});

describe('voice runtime request snapshots', () => {
  test('does not bind a pending permission check to a different channel', async () => {
    const gate = await createPermissionGate('join');
    const runtime = new VoiceRuntime(2);
    const nextRuntime = new VoiceRuntime(3);
    gate.context.currentVoiceChannelId = runtime.id;
    try {
      gate.arm();
      const pending = getCurrentVoiceRuntime(gate.context);
      const rejected = pending.catch((error: unknown) => error);
      await gate.entered;
      gate.context.currentVoiceChannelId = nextRuntime.id;
      gate.release();
      expect(await rejected).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'User is not in a voice channel'
      });
    } finally {
      gate.release();
      await runtime.destroy();
      await nextRuntime.destroy();
    }
  });

  test('does not bind a pending permission check to a replacement runtime', async () => {
    const gate = await createPermissionGate('join');
    const runtime = new VoiceRuntime(2);
    let replacement: VoiceRuntime | undefined;
    gate.context.currentVoiceChannelId = runtime.id;
    try {
      gate.arm();
      const pending = getCurrentVoiceRuntime(gate.context);
      const rejected = pending.catch((error: unknown) => error);
      await gate.entered;
      await runtime.destroy();
      replacement = new VoiceRuntime(2);
      gate.release();
      expect(await rejected).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Voice runtime not found for this channel'
      });
    } finally {
      gate.release();
      await runtime.destroy();
      await replacement?.destroy();
    }
  });

  test.each([undefined, 999999])(
    'preserves permission rejection before existence errors for channel %s',
    async (channelId) => {
      const context = await createMockContext({
        customToken: await getMockedToken(1)
      });
      context.currentVoiceChannelId = channelId;
      context.needsPermission = async () => {
        invariant(false, {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions'
        });
      };
      await expect(getCurrentVoiceRuntime(context)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions'
      });
    }
  );
});
