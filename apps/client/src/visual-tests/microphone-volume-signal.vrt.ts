import {
  VoiceProvider,
  VoiceProviderContext,
  type TVoiceProvider
} from '@/components/voice-provider';
import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

const state = vi.hoisted(() => {
  const noop = () => {};
  const asyncNoop = async () => {};
  const direct = {
    start: async () => 'relay',
    stop: noop,
    close: noop,
    getConnections: () => []
  };
  return {
    start: asyncNoop,
    devices: {
      microphoneVolume: 100,
      playbackVolume: 100,
      noiseGateEnabled: false,
      noiseSuppression: 'none',
      directScreenSharing: false
    },
    transport: {
      current: {
        produce: vi.fn(async () => {
          const publication = {
            id: 'mic',
            paused: false,
            pause() {
              publication.paused = true;
            },
            resume() {
              publication.paused = false;
            },
            close: noop,
            observer: { on: noop }
          };
          return publication;
        })
      }
    },
    direct,
    noop,
    asyncNoop
  };
});
vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({ devices: state.devices })
}));
vi.mock('@/features/server/channels/hooks', () => ({
  useCurrentVoiceChannelId: () => 1
}));
vi.mock('@/features/server/hooks', () => ({
  useWebRtcSimulcastEnabled: () => false,
  useCurrentVoicePeers: () => []
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useOwnVoiceState: () => ({ micMuted: false, soundMuted: false })
}));
vi.mock('@/features/server/voice/actions', () => ({
  updateOwnVoiceState: () => {}
}));
vi.mock('@/components/voice-provider/hooks/use-voice-controls', () => ({
  useVoiceControls: ({
    startMicStream
  }: {
    startMicStream: () => Promise<void>;
  }) => {
    state.start = startMicStream;
    return {
      toggleMic: state.asyncNoop,
      toggleSound: state.asyncNoop,
      toggleWebcam: state.asyncNoop,
      toggleScreenShare: state.asyncNoop
    };
  }
}));
vi.mock('@/components/voice-provider/hooks/use-transports', () => ({
  useTransports: () => ({
    producerTransport: state.transport,
    consumerTransport: { current: null },
    sessionGenerationRef: { current: 0 },
    consumers: { current: {} },
    consumerStreams: { current: new Map() },
    consumeOperationsInProgress: { current: new Map() },
    consumeRef: { current: null },
    createProducerTransport: state.asyncNoop,
    createConsumerTransport: state.asyncNoop,
    consumeExistingProducers: state.asyncNoop,
    cleanupTransports: state.noop,
    getConsumer: state.noop,
    getConsumerCodec: state.noop,
    pauseDemoConsumers: state.asyncNoop,
    closeConsumer: state.noop,
    closeConsumers: state.noop
  })
}));
vi.mock('@/components/voice-provider/hooks/use-direct-media', () => ({
  useDirectMedia: () => ({
    directMedia: {
      audio: state.direct,
      video: state.direct,
      screen: state.direct
    }
  })
}));
vi.mock('@/components/voice-provider/hooks/use-transport-stats', () => ({
  useTransportStats: () => ({
    stats: {},
    subscribe: () => state.noop,
    startMonitoring: state.noop,
    stopMonitoring: state.noop,
    resetStats: state.noop,
    setScreenShareProducer: state.noop
  })
}));
vi.mock('@/components/voice-provider/demo-visibility-context', () => ({
  DemoVisibilityProvider: ({ children }: { children: React.ReactNode }) =>
    children
}));
vi.mock('@/components/voice-provider/remote-webcam-visibility-context', () => ({
  RemoteWebcamVisibilityProvider: ({
    children
  }: {
    children: React.ReactNode;
  }) => children
}));
vi.mock('@/components/voice-provider/volume-control-context', () => ({
  VolumeControlProvider: ({ children }: { children: React.ReactNode }) =>
    children
}));
vi.mock('@/hooks/use-screen-share-support', () => ({
  useScreenShareSupport: () => ({ isScreenShareSupported: false })
}));
vi.mock('@/helpers/browser-logger', () => ({
  logDebug: () => {},
  logVoice: () => {},
  logVoiceWarn: () => {},
  logVoiceError: () => {}
}));
vi.mock('@/helpers/sounds', () => ({ playSound: () => {} }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test('published microphone samples respond live to gain without a new capture', async () => {
  const context = new AudioContext();
  const source = context.createOscillator();
  source.frequency.value = 440;
  const captured = context.createMediaStreamDestination();
  source.connect(captured);
  source.start();
  const capture = vi
    .spyOn(navigator.mediaDevices, 'getUserMedia')
    .mockResolvedValue(captured.stream);
  let voice: TVoiceProvider | undefined;
  const Probe = () => {
    voice = useContext(VoiceProviderContext);
    return null;
  };
  const host = document.createElement('div');
  const start = document.createElement('button');
  start.textContent = 'Start';
  start.onclick = () => {
    context.resume();
    state.start();
  };
  document.body.append(host, start);
  const root = createRoot(host);
  const render = async () => {
    await act(async () => {
      root.render(
        createElement(VoiceProvider, { children: createElement(Probe) })
      );
    });
  };
  try {
    await render();
    await userEvent.click(start);
    await expect.poll(() => voice?.localAudioStream).toBeDefined();
    const stream = voice!.localAudioStream!;
    expect(state.transport.current.produce).toHaveBeenCalledWith(
      expect.objectContaining({ track: stream.getAudioTracks()[0] })
    );
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const received = context.createMediaStreamSource(stream);
    received.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const rms = () => {
      analyser.getFloatTimeDomainData(samples);
      const sum = samples.reduce((total, sample) => total + sample * sample, 0);
      return Math.sqrt(sum / samples.length);
    };
    await expect.poll(rms).toBeGreaterThan(0.6);
    state.devices.microphoneVolume = 25;
    await render();
    await expect.poll(rms).toBeLessThan(0.2);
    expect(rms()).toBeGreaterThan(0.15);
    state.devices.microphoneVolume = 0;
    await render();
    await expect.poll(rms).toBeLessThan(0.001);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(voice!.localAudioStream).toBe(stream);
  } finally {
    await act(async () => root.unmount());
    capture.mockRestore();
    source.stop();
    await context.close();
    host.remove();
    start.remove();
  }
});
