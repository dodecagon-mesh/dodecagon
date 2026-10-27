import { useTransports } from '@/components/voice-provider/hooks/use-transports';
import { setCurrentVoiceChannelId } from '@/features/server/channels/actions';
import { serverSliceActions } from '@/features/server/slice';
import { addUserToVoiceChannel } from '@/features/server/voice/actions';
import { store } from '@/features/store';
import * as trpc from '@/lib/trpc';
import { StreamKind } from '@dodecagon/shared';
import type { Transport } from 'mediasoup-client/types';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@/lib/trpc', { spy: true });

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let hook: ReturnType<typeof useTransports> | undefined;
let stream: MediaStream | undefined;
afterEach(() => {
  hook?.cleanupTransports();
  root?.unmount();
  root = undefined;
  hook = undefined;
  host?.remove();
  stream?.getTracks().forEach((track) => track.stop());
  setCurrentVoiceChannelId(undefined);
  store.dispatch(
    serverSliceActions.removeUserFromVoiceChannel({ userId: 1, channelId: 2 })
  );
  store.dispatch(
    serverSliceActions.removeUserFromVoiceChannel({ userId: 2, channelId: 2 })
  );
  vi.restoreAllMocks();
});

test('requests the first screen keyframe only after native receive and stream attachment', async () => {
  const nativeReady = Promise.withResolvers<void>();
  const resumeReady = Promise.withResolvers<void>();
  const attached = vi.fn();
  const canvas = document.createElement('canvas');
  stream = canvas.captureStream();
  const [track] = stream.getVideoTracks();
  const consumer = {
    id: 'consumer-screen',
    producerId: 'producer-screen',
    track,
    paused: false,
    pause: vi.fn(() => {
      consumer.paused = true;
      track.enabled = false;
    }),
    resume: vi.fn(() => {
      consumer.paused = false;
      track.enabled = true;
    }),
    closed: false,
    rtpParameters: { codecs: [] },
    on: vi.fn(),
    close: vi.fn()
  };
  const nativeConsume = vi.fn(async () => {
    await nativeReady.promise;
    return consumer;
  });
  const resume = vi.fn(async () => {
    expect(attached).toHaveBeenCalledTimes(1);
    return resumeReady.promise;
  });
  vi.mocked(trpc.getTRPCClient).mockReturnValue({
    voice: {
      consume: {
        mutate: vi.fn(async () => ({
          producerId: consumer.producerId,
          consumerId: consumer.id,
          consumerKind: StreamKind.SCREEN,
          consumerRtpParameters: {},
          consumerType: 'simple',
          qualityLayers: []
        }))
      },
      resumeConsumer: { mutate: resume }
    }
  } as unknown as ReturnType<typeof trpc.getTRPCClient>);
  const Fixture = () => {
    hook = useTransports({
      voiceOnlyMode: false,
      canConsumeScreen: () => true,
      addRemoteUserStream: attached,
      removeRemoteUserStream: vi.fn(),
      addExternalStreamTrack: vi.fn(),
      removeExternalStreamTrack: vi.fn(),
      setRemoteConsumerType: vi.fn(),
      setRemoteStreamQualityLayers: vi.fn(),
      clearRemoteConsumerMetadata: vi.fn()
    });
    return null;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(Fixture));
  await expect.poll(() => hook).toBeDefined();
  hook!.consumerTransport.current = {
    closed: false,
    consume: nativeConsume,
    close: vi.fn()
  } as unknown as Transport;
  const pending = hook!.consume(2, StreamKind.SCREEN, { codecs: [] });
  await expect.poll(() => nativeConsume.mock.calls.length).toBe(1);
  expect(resume).not.toHaveBeenCalled();
  nativeReady.resolve();
  await expect.poll(() => attached.mock.calls.length).toBe(1);
  await expect.poll(() => resume.mock.calls.length).toBe(1);
  resumeReady.resolve();
  await pending;
});

test('retries an unacknowledged server resume without replacing a live screen consumer', async () => {
  const canvas = document.createElement('canvas');
  stream = canvas.captureStream();
  const [track] = stream.getVideoTracks();
  const consumer = {
    id: 'consumer-retry',
    producerId: 'producer-screen',
    track,
    paused: false,
    closed: false,
    rtpParameters: { codecs: [] },
    on: vi.fn(),
    close: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  };
  const nativeConsume = vi.fn(async () => consumer);
  const resume = vi
    .fn()
    .mockRejectedValueOnce(new Error('resume request did not reach the server'))
    .mockResolvedValue(undefined);
  vi.mocked(trpc.getTRPCClient).mockReturnValue({
    voice: {
      consume: {
        mutate: vi.fn(async () => ({
          producerId: consumer.producerId,
          consumerId: consumer.id,
          consumerKind: StreamKind.SCREEN,
          consumerRtpParameters: {},
          consumerType: 'simple',
          qualityLayers: []
        }))
      },
      resumeConsumer: { mutate: resume }
    }
  } as unknown as ReturnType<typeof trpc.getTRPCClient>);
  const Fixture = () => {
    hook = useTransports({
      voiceOnlyMode: false,
      canConsumeScreen: () => true,
      addRemoteUserStream: vi.fn(),
      removeRemoteUserStream: vi.fn(),
      addExternalStreamTrack: vi.fn(),
      removeExternalStreamTrack: vi.fn(),
      setRemoteConsumerType: vi.fn(),
      setRemoteStreamQualityLayers: vi.fn(),
      clearRemoteConsumerMetadata: vi.fn()
    });
    return null;
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(Fixture));
  await expect.poll(() => hook).toBeDefined();
  hook!.consumerTransport.current = {
    closed: false,
    consume: nativeConsume,
    close: vi.fn()
  } as unknown as Transport;
  await hook!.consume(2, StreamKind.SCREEN, { codecs: [] });
  await hook!.consume(2, StreamKind.SCREEN, { codecs: [] });
  expect(resume).toHaveBeenCalledTimes(2);
  expect(nativeConsume).toHaveBeenCalledTimes(1);
  expect(consumer.pause).not.toHaveBeenCalled();
});

test.each([
  StreamKind.AUDIO,
  StreamKind.VIDEO,
  StreamKind.SCREEN,
  StreamKind.SCREEN_AUDIO
])(
  'keeps the SFU relay available as a %s fallback for a direct pair',
  async (kind) => {
    const request = vi.fn(async () => {
      throw new Error('relay fallback attempted');
    });
    vi.mocked(trpc.getTRPCClient).mockReturnValue({
      voice: { consume: { mutate: request } }
    } as unknown as ReturnType<typeof trpc.getTRPCClient>);
    setCurrentVoiceChannelId(2);
    for (const id of [1, 2])
      addUserToVoiceChannel(id, 2, {
        micMuted: false,
        soundMuted: false,
        webcamEnabled: false,
        sharingScreen: false,
        directMediaEnabled: true
      });
    const Fixture = () => {
      hook = useTransports({
        voiceOnlyMode: false,
        canConsumeScreen: () => true,
        addRemoteUserStream: vi.fn(),
        removeRemoteUserStream: vi.fn(),
        addExternalStreamTrack: vi.fn(),
        removeExternalStreamTrack: vi.fn(),
        setRemoteConsumerType: vi.fn(),
        setRemoteStreamQualityLayers: vi.fn(),
        clearRemoteConsumerMetadata: vi.fn()
      });
      return null;
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    root.render(createElement(Fixture));
    await expect.poll(() => hook).toBeDefined();
    hook!.consumerTransport.current = {
      closed: false,
      close: vi.fn(),
      consume: vi.fn()
    } as unknown as Transport;
    await hook!.consume(2, kind, { codecs: [] }).catch(() => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      remoteId: 2,
      kind,
      rtpCapabilities: { codecs: [] },
      requestDirect: true
    });
  }
);
