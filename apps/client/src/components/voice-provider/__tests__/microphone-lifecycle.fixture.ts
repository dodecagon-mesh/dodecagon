import * as ChannelSelectors from '@/features/server/channels/selectors';
import { NoiseSuppression } from '@/types';
import { ChannelType, StreamKind } from '@dodecagon/shared';
import type { Mock } from 'bun:test';
import { beforeEach, expect, mock, test } from 'bun:test';
import * as React from 'react';
import * as ReactI18n from 'react-i18next';
import {
  DirectMedia,
  type TDirectMediaResult,
  type TDirectScreenBundle
} from '../direct-media';
import type { useDirectMedia } from '../hooks/use-direct-media';
import type { TConsumeOptions, useTransports } from '../hooks/use-transports';

// Run the real provider and channel-selection caller; substitute the scheduler,
// browser capture/processing and network/transport boundaries only.
let slots: unknown[] = [];
let cursor = 0;
let effects: (() => void | (() => void))[] = [];
mock.module('react', () => ({
  ...React,
  memo: <T>(value: T) => value,
  useRef: (value: unknown) => {
    const index = cursor++;
    return (slots[index] ??= { current: value });
  },
  useState: (value: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = value;
    return [
      slots[index],
      (next: unknown) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }
    ];
  },
  useCallback: <T>(value: T) => value,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  }
}));
mock.module('@/helpers/browser-logger', () => ({
  logDebug() {},
  logVoice() {},
  logVoiceWarn() {},
  logVoiceError() {}
}));
mock.module('@/helpers/sounds', () => ({ playSound() {} }));
mock.module('@/helpers/voice-debug', () => ({
  pushVoiceDebugEvent() {},
  registerVoiceDebugSource: () => () => {}
}));
mock.module('@/hooks/use-screen-share-support', () => ({
  useScreenShareSupport: () => ({ isScreenShareSupported: false })
}));
mock.module('react-i18next', () => ({
  ...ReactI18n,
  useTranslation: () => ({ t: (key: string) => key })
}));
const errorToast = mock(() => {});
const infoToast = mock(() => {});
mock.module('sonner', () => ({
  toast: { error: errorToast, info: infoToast }
}));
let channelId: number | undefined;
let rerenderProvider = () => {};
let nativeMediaAvailable = true;
let peers: {
  id: number;
  state: { directMediaEnabled: boolean; voiceOnlyMode?: boolean };
}[] = [];
const nativePeers = () => [
  { id: 2, state: { directMediaEnabled: true } },
  { id: 3, state: { directMediaEnabled: true } }
];
mock.module('../holepunch-media', () => ({
  getHolepunchMedia: () => (nativeMediaAvailable ? { version: 1 } : undefined)
}));
mock.module('@/features/server/channels/hooks', () => ({
  useCurrentVoiceChannelId: () => channelId
}));
mock.module('@/features/server/hooks', () => ({
  useWebRtcSimulcastEnabled: () => false,
  useCurrentVoicePeers: () => peers
}));
const leaveVoice = mock(async () => {});
mock.module('@/features/server/voice/actions', () => ({
  updateOwnVoiceState() {},
  joinVoice: async (id: number) => {
    channelId = id;
    rerenderProvider();
    return {};
  },
  leaveVoice
}));
mock.module('@/features/server/channels/actions', () => ({
  setSelectedChannelId() {}
}));
mock.module('@/features/server/channels/selectors', () => ({
  ...ChannelSelectors,
  channelByIdSelector: (_state: unknown, id: number) => ({
    id,
    type: ChannelType.VOICE
  })
}));
mock.module('@/features/store', () => ({
  store: { getState: () => ({}), dispatch() {} },
  useStoreSelector: (selector: (state: unknown) => unknown) => selector({})
}));

let voice: import('../index').TVoiceProvider;
let micMuted = false;
mock.module('@/features/server/voice/hooks', () => ({
  useOwnVoiceState: () => ({ micMuted, soundMuted: false }),
  useVoice: () => voice
}));
const devices = {
  microphoneId: 'default',
  microphoneVolume: 100,
  noiseSuppression: 'disabled',
  noiseGateEnabled: false,
  directScreenSharing: false
};
mock.module('../../devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({ devices })
}));
for (const [path, name] of [
  ['../demo-visibility-context', 'DemoVisibilityProvider'],
  ['../remote-webcam-visibility-context', 'RemoteWebcamVisibilityProvider'],
  ['../volume-control-context', 'VolumeControlProvider']
])
  mock.module(path!, () => ({ [name!]: () => null }));
const directStartForPeer = mock(
  async (
    _peerId: number,
    _stream: Stream,
    _options: Parameters<DirectMedia['startForPeer']>[2]
  ): Promise<TDirectMediaResult> => 'direct'
);
const directAudioStart = mock(
  async (
    _peerId: number,
    _stream: Stream,
    _options: Parameters<DirectMedia['startForPeer']>[2]
  ): Promise<TDirectMediaResult> => 'direct'
);
const directVideoStart = mock(
  async (
    _peerId: number,
    _stream: Stream,
    _options: Parameters<DirectMedia['startForPeer']>[2]
  ): Promise<TDirectMediaResult> => 'direct'
);
const stopAudioPeer = mock((_peerId: number) => {});
const stopVideoPeer = mock((_peerId: number) => {});
let directCallbacks: Parameters<typeof useDirectMedia>[0];
mock.module('../hooks/use-direct-media', () => ({
  useDirectMedia: (params: typeof directCallbacks) => {
    directCallbacks = params;
    return {
      directMedia: {
        [StreamKind.AUDIO]: {
          startForPeer: directAudioStart,
          stopForPeer: stopAudioPeer,
          close() {},
          stop() {}
        },
        [StreamKind.VIDEO]: {
          startForPeer: directVideoStart,
          stopForPeer: stopVideoPeer,
          close() {},
          stop() {}
        },
        [StreamKind.SCREEN]: {
          startForPeer: directStartForPeer,
          close() {},
          stop() {},
          acceptPendingOffer() {},
          stopReceiving() {}
        }
      }
    };
  }
}));
const monitor = mock(() => {});
mock.module('../hooks/use-transport-stats', () => ({
  useTransportStats: () => ({
    startMonitoring: monitor,
    stopMonitoring() {},
    resetStats() {},
    setScreenShareProducer() {}
  })
}));
mock.module('mediasoup-client', () => ({
  Device: class {
    rtpCapabilities = {};
    async load() {}
  }
}));
const updateState = mock(async () => {});
const closeProducer = mock(
  async (_input: { kind: string; producerId?: string }) => {}
);
const trpcClient = {
  // the real server publishes demand independently of producer pause state.
  voice: {
    updateState: { mutate: updateState },
    onRelayDemand: {
      subscribe: (
        _input: undefined,
        callbacks: {
          onData: (event: {
            channelId: number;
            kind: StreamKind;
            required: boolean;
          }) => void;
          onError: (error: Error) => void;
        }
      ) => {
        relayDemand = (event) => {
          serverRelayDemand.set(
            `${event.channelId}-${event.kind}`,
            event.required
          );
          callbacks.onData(event);
        };
        relayDemandError = callbacks.onError;
        for (const kind of [
          StreamKind.AUDIO,
          StreamKind.VIDEO,
          StreamKind.SCREEN,
          StreamKind.SCREEN_AUDIO
        ]) {
          callbacks.onData({
            channelId: channelId!,
            kind,
            required: serverRelayDemand.get(`${channelId}-${kind}`) ?? false
          });
        }
        return { unsubscribe() {} };
      }
    },
    closeProducer: { mutate: closeProducer }
  }
};
mock.module('@/lib/trpc', () => ({
  cleanup() {},
  connectToTRPC: async () => {},
  getTRPCClient: () => trpcClient
}));
const generation = { current: 0 };
let relayDemand: (event: {
  channelId: number;
  kind: StreamKind;
  required: boolean;
}) => void = () => {};
let relayDemandError: (error: Error) => void = () => {};
const serverRelayDemand = new Map<string, boolean>();
const send = { current: undefined as TTestTransport | undefined };
const recv = { current: undefined as TTestTransport | undefined };
type TTestProducer = {
  id: string;
  closed: boolean;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  close: () => void;
  observer: { on: (event: string, listener: () => void) => void };
};
type TTestTransport = {
  closed: boolean;
  close: () => void;
  produce: Mock<(options: unknown) => Promise<TTestProducer>>;
};
const producer = (): TTestProducer => {
  const listeners: (() => void)[] = [];
  const value: TTestProducer = {
    id: crypto.randomUUID(),
    closed: false,
    paused: false,
    pause() {
      value.paused = true;
    },
    resume() {
      value.paused = false;
    },
    close: mock(() => {
      if (value.closed) return;
      value.closed = true;
      listeners.forEach((listener) => listener());
    }),
    observer: {
      on(event: string, listener: () => void) {
        if (event === 'close') listeners.push(listener);
      }
    }
  };
  return value;
};
let nextProduction: Promise<TTestProducer> | undefined;
function transport(): TTestTransport {
  const pending = nextProduction;
  nextProduction = undefined;
  const value: TTestTransport = {
    closed: false,
    close() {
      value.closed = true;
    },
    produce: mock<(options: unknown) => Promise<TTestProducer>>(
      async (_options: unknown): Promise<TTestProducer> => pending ?? producer()
    )
  };
  return value;
}
const producedAt = async (
  activeTransport: TTestTransport,
  index: number
): Promise<TTestProducer> => {
  const result = activeTransport.produce.mock.results[index];
  if (!result || result.type !== 'return') {
    throw new Error('Expected produce to return a producer');
  }
  return await result.value;
};
let consumerCreation: Promise<void> | undefined;
const consumeExistingProducers = mock(
  async (
    _rtps: unknown,
    _options?: { isViewingDemo?: (id: number) => boolean }
  ) => {}
);
type TTestConsumer = {
  closed: boolean;
  track: Track;
};
const relayConsumers = {
  current: {} as Record<number, Partial<Record<StreamKind, TTestConsumer>>>
};
const relayStreams = { current: new Map<string, Stream>() };
const consumeOperations = { current: new Map<string, Promise<void>>() };
const consumeRelay = mock(
  async (
    _remoteId: number,
    _kind: StreamKind,
    _rtpCapabilities: unknown,
    _options?: TConsumeOptions
  ) => {}
);
const consumeRelayRef = { current: consumeRelay };
let transportCallbacks: Parameters<typeof useTransports>[0];
mock.module('../hooks/use-transports', () => ({
  useTransports: (params: typeof transportCallbacks) => {
    transportCallbacks = params;
    return {
      producerTransport: send,
      consumerTransport: recv,
      sessionGenerationRef: generation,
      consumers: relayConsumers,
      consumerStreams: relayStreams,
      consumeOperationsInProgress: consumeOperations,
      consumeRef: consumeRelayRef,
      createProducerTransport: async () => {
        send.current = transport();
      },
      createConsumerTransport: async () => {
        if (consumerCreation) await consumerCreation;
        recv.current = transport();
      },
      consumeExistingProducers,
      cleanupTransports: () => {
        generation.current++;
        send.current?.close();
        recv.current?.close();
        send.current = recv.current = undefined;
      },
      closeConsumer() {},
      closeConsumers() {},
      markDemoConsumersPaused() {},
      pauseDemoConsumers() {},
      getConsumer() {},
      getConsumerCodec() {}
    };
  }
}));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
class Track {
  kind = 'audio';
  contentHint = '';
  id = 'mic';
  label = 'mic';
  enabled = true;
  readyState = 'live';
  onended: (() => void) | null = null;
  stop() {
    this.readyState = 'ended';
  }
  getSettings() {
    return {};
  }
}
class Stream {
  constructor(public tracks = [new Track()]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}
const capture = mock(async () => new Stream());
const gate = mock(async () => ({ connect() {}, disconnect: mock(() => {}) }));
const suppress = mock(
  async (
    _type: unknown,
    _stream: unknown,
    register?: (context: AudioContext) => void
  ) => {
    const context = new Context();
    register?.(context as unknown as AudioContext);
    return { contexts: [context], outputTrack: context.output.tracks[0]! };
  }
);
mock.module('@/helpers/audio-worklet/ns-worklet', () => ({
  createNsChain: suppress
}));
const contexts: Context[] = [];
class Context {
  currentTime = 0;
  gainNode = {
    gain: {
      value: 1,
      setTargetAtTime(value: number) {
        this.value = value;
      }
    },
    connect() {},
    disconnect() {}
  };
  createGain() {
    return this.gainNode;
  }
  closed = false;
  closeCalls = 0;
  rejectClose = false;
  output = new Stream();
  constructor() {
    contexts.push(this);
  }
  close() {
    this.closeCalls++;
    this.closed = true;
    if (this.rejectClose)
      return Promise.reject(new Error('context close failed'));
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createMediaStreamDestination() {
    return { stream: this.output };
  }
}
mock.module('@/helpers/audio-worklet/noise-gate-worklet', () => ({
  createNoiseGateWorkletNode: gate,
  getNoiseGateWorkletAvailabilitySnapshot: () => ({ available: true }),
  markNoiseGateWorkletUnavailable() {},
  postNoiseGateWorkletConfig() {}
}));
Object.assign(globalThis, {
  MediaStream: Stream,
  window: { AudioContext: Context },
  localStorage: { getItem: () => null, setItem() {} }
});
const { VoiceProvider } = await import('../index');
const { useSelectChannel } = await import('@/hooks/use-select-channel');
const render = () => {
  cursor = 0;
  effects = [];
  const tree = (
    VoiceProvider as unknown as (props: {
      children: null;
    }) => React.ReactElement<{ value: typeof voice }>
  )({ children: null });
  voice = tree.props.value;
  return voice;
};
rerenderProvider = () => {
  render();
};
const initializeSession = (id: number) => {
  channelId = id;
  rerenderProvider();
  return voice.init({}, id);
};
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
beforeEach(() => {
  consumerCreation = undefined;
  consumeExistingProducers.mockClear();
  consumeRelay.mockReset();
  consumeRelay.mockImplementation(async () => {});
  consumeRelayRef.current = consumeRelay;
  slots = [];
  contexts.length = 0;
  generation.current = 0;
  send.current = recv.current = undefined;
  nextProduction = undefined;
  relayConsumers.current = {};
  relayStreams.current.clear();
  consumeOperations.current.clear();
  channelId = 1;
  micMuted = false;
  devices.noiseGateEnabled = false;
  devices.microphoneVolume = 100;
  devices.microphoneId = 'default';
  devices.noiseSuppression = 'disabled';
  devices.directScreenSharing = false;
  peers = [];
  nativeMediaAvailable = true;
  stopAudioPeer.mockClear();
  stopVideoPeer.mockClear();
  relayDemand = () => {};
  relayDemandError = () => {};
  serverRelayDemand.clear();
  directStartForPeer.mockReset();
  directStartForPeer.mockImplementation(async () => 'direct');
  directAudioStart.mockReset();
  directAudioStart.mockImplementation(async () => 'direct');
  directVideoStart.mockReset();
  directVideoStart.mockImplementation(async () => 'direct');
  suppress.mockReset();
  suppress.mockImplementation(async (_type, _stream, register) => {
    const context = new Context();
    register?.(context as unknown as AudioContext);
    return { contexts: [context], outputTrack: context.output.tracks[0]! };
  });
  capture.mockReset();
  capture.mockImplementation(async () => new Stream());
  gate.mockReset();
  gate.mockImplementation(async () => ({
    connect() {},
    disconnect: mock(() => {})
  }));
  leaveVoice.mockClear();
  errorToast.mockClear();
  monitor.mockClear();
  updateState.mockReset();
  updateState.mockImplementation(async () => {});
  closeProducer.mockReset();
  closeProducer.mockImplementation(async () => {});
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: capture } }
  });
  render();
});

test('microphone volume changes the published processing gain without recapturing', async () => {
  devices.microphoneVolume = 40;
  render();
  effects.forEach((effect) => effect());
  await initializeSession(1);
  const context = contexts.find((candidate) => !candidate.closed);
  expect(context).toBeDefined();
  expect(context?.gainNode.gain.value).toBe(0.4);
  const captures = capture.mock.calls.length;
  devices.microphoneVolume = 0;
  render();
  effects.forEach((effect) => effect());
  expect(context?.gainNode.gain.value).toBe(0);
  expect(capture.mock.calls.length).toBe(captures);
});

test('changing the selected microphone replaces live capture without reconnecting', async () => {
  const firstCapture = new Stream();
  capture.mockImplementationOnce(async () => firstCapture);
  await initializeSession(1);
  const activeTransport = send.current;
  devices.microphoneId = 'usb-mic';
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(capture).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenLastCalledWith(
    expect.objectContaining({
      audio: expect.objectContaining({ deviceId: { exact: 'usb-mic' } })
    })
  );
  expect(firstCapture.tracks[0]!.readyState).toBe('ended');
  expect(send.current).toBe(activeTransport);
});

test('produces relay and starts a per-viewer direct screen session without recapturing', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const audio = new Track();
  const stream = new Stream([video, audio]);
  const picker = mock(async () => stream);
  Object.assign(navigator.mediaDevices, { getDisplayMedia: picker });
  await initializeSession(1);
  await voice.toggleScreenShare();
  const transport = send.current!;
  expect(transport.produce).toHaveBeenCalledTimes(3);
  await voice.onScreenViewerStarted(2);
  expect(directStartForPeer).toHaveBeenCalledTimes(1);
  expect(directStartForPeer.mock.calls[0]![0]).toBe(2);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(video.readyState).toBe('live');
  expect(audio.readyState).toBe('live');
});

test('a direct screen failure keeps the relay share and capture alive', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const audio = new Track();
  const stream = new Stream([video, audio]);
  const picker = mock(async () => stream);
  Object.assign(navigator.mediaDevices, { getDisplayMedia: picker });
  await initializeSession(1);
  await voice.toggleScreenShare();
  await voice.onScreenViewerStarted(2);
  const failure = directStartForPeer.mock.calls[0]![2].onFailure;
  await failure(true, 2);
  expect(directStartForPeer).toHaveBeenCalledTimes(1);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(video.readyState).toBe('live');
  expect(audio.readyState).toBe('live');
  expect(send.current!.produce).toHaveBeenCalledTimes(3);
  expect(render().localScreenShareStream?.getVideoTracks()[0]).toBe(
    video as unknown as MediaStreamTrack
  );
});

test('a retired direct peer cannot stop the replacement captured share', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const stream = new Stream([video]);
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: mock(async () => stream)
  });
  await initializeSession(1);
  await voice.toggleScreenShare();
  await voice.onScreenViewerStarted(2);
  const oldFailure = directStartForPeer.mock.calls[0]![2].onFailure;
  await oldFailure(false, 2);
  expect(video.readyState).toBe('live');
  expect(render().localScreenShareStream?.getVideoTracks()[0]).toBe(
    video as unknown as MediaStreamTrack
  );
});

test('starts an independent direct screen session for each viewer', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const stream = new Stream([video]);
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: mock(async () => stream)
  });
  await initializeSession(1);
  await voice.toggleScreenShare();
  await voice.onScreenViewerStarted(2);
  await voice.onScreenViewerStarted(3);
  expect(directStartForPeer).toHaveBeenCalledTimes(2);
  expect(directStartForPeer.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  const firstFailure = directStartForPeer.mock.calls[0]![2].onFailure;
  await firstFailure(true, 2);
  expect(video.readyState).toBe('live');
  expect(directStartForPeer).toHaveBeenCalledTimes(2);
});

test('a failed direct screen peer never takes down the relay share', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const audio = new Track();
  const picker = mock(async () => new Stream([video, audio]));
  Object.assign(navigator.mediaDevices, { getDisplayMedia: picker });
  await initializeSession(1);
  await voice.toggleScreenShare();
  directStartForPeer.mockImplementation(async () => 'failed');
  await voice.onScreenViewerStarted(2);
  await flush();
  expect(send.current!.produce).toHaveBeenCalledTimes(3);
  expect(picker).toHaveBeenCalledTimes(1);
  expect(video.readyState).toBe('live');
  expect(audio.readyState).toBe('live');
});

test('direct fallback restores retained screen video after optional relay audio ends', async () => {
  await initializeSession(1);
  const relayVideoTrack = new Track();
  relayVideoTrack.kind = 'video';
  const relayAudioTrack = new Track();
  const directVideoTrack = new Track();
  directVideoTrack.kind = 'video';
  const directAudioTrack = new Track();
  const relayVideo = new Stream([relayVideoTrack]);
  const relayAudio = new Stream([relayAudioTrack]);
  const directVideo = new Stream([directVideoTrack]);
  const directAudio = new Stream([directAudioTrack]);
  relayConsumers.current[2] = {
    [StreamKind.SCREEN]: { closed: false, track: relayVideoTrack },
    [StreamKind.SCREEN_AUDIO]: { closed: false, track: relayAudioTrack }
  };
  relayStreams.current.set(`2-${StreamKind.SCREEN}`, relayVideo);
  relayStreams.current.set(`2-${StreamKind.SCREEN_AUDIO}`, relayAudio);
  voice.isViewingDemoRef.current = (id) => id === 2;
  const directBundle = {
    screen: directVideo,
    screenAudio: directAudio
  } as unknown as TDirectScreenBundle;

  expect(directCallbacks.presentDirectScreenBundle(2, directBundle)).toBe(true);
  render();
  expect(voice.remoteUserStreams[2]?.[StreamKind.SCREEN]).toBe(
    directVideo as unknown as MediaStream
  );
  delete relayConsumers.current[2]![StreamKind.SCREEN_AUDIO];
  relayStreams.current.delete(`2-${StreamKind.SCREEN_AUDIO}`);

  directCallbacks.retireDirectScreenBundle(2, directBundle, {
    restoreRelay: true
  });
  render();

  expect(voice.remoteUserStreams[2]?.[StreamKind.SCREEN]).toBe(
    relayVideo as unknown as MediaStream
  );
  expect(voice.remoteUserStreams[2]?.[StreamKind.SCREEN_AUDIO]).toBeUndefined();
  expect(relayVideoTrack.readyState).toBe('live');
});

test('direct fallback publishes a replacement relay bundle member', async () => {
  await initializeSession(1);
  const relayVideoTrack = new Track();
  relayVideoTrack.kind = 'video';
  const relayAudioTrack = new Track();
  const directVideoTrack = new Track();
  directVideoTrack.kind = 'video';
  const directAudioTrack = new Track();
  const relayVideo = new Stream([relayVideoTrack]);
  const relayAudio = new Stream([relayAudioTrack]);
  const directVideo = new Stream([directVideoTrack]);
  const directAudio = new Stream([directAudioTrack]);
  relayConsumers.current[2] = {
    [StreamKind.SCREEN]: { closed: false, track: relayVideoTrack },
    [StreamKind.SCREEN_AUDIO]: { closed: false, track: relayAudioTrack }
  };
  relayStreams.current.set(`2-${StreamKind.SCREEN}`, relayVideo);
  relayStreams.current.set(`2-${StreamKind.SCREEN_AUDIO}`, relayAudio);
  voice.isViewingDemoRef.current = (id) => id === 2;
  const directBundle = {
    screen: directVideo,
    screenAudio: directAudio
  } as unknown as TDirectScreenBundle;
  expect(directCallbacks.presentDirectScreenBundle(2, directBundle)).toBe(true);

  const replacementAudioTrack = new Track();
  const replacementAudio = new Stream([replacementAudioTrack]);
  relayConsumers.current[2]![StreamKind.SCREEN_AUDIO] = {
    closed: false,
    track: replacementAudioTrack
  };
  relayStreams.current.set(`2-${StreamKind.SCREEN_AUDIO}`, replacementAudio);
  transportCallbacks.addRemoteUserStream(
    2,
    replacementAudio as unknown as MediaStream,
    StreamKind.SCREEN_AUDIO
  );
  render();
  expect(voice.remoteUserStreams[2]?.[StreamKind.SCREEN_AUDIO]).toBe(
    directAudio as unknown as MediaStream
  );

  directCallbacks.retireDirectScreenBundle(2, directBundle, {
    restoreRelay: true
  });
  render();

  expect(voice.remoteUserStreams[2]?.[StreamKind.SCREEN_AUDIO]).toBe(
    replacementAudio as unknown as MediaStream
  );
});

test('direct preparation creates missing relay media without another direct request', async () => {
  await initializeSession(1);
  voice.isViewingDemoRef.current = (id) => id === 2;
  consumeRelay.mockImplementation(
    async (userId, kind, _rtpCapabilities, _options) => {
      const track = new Track();
      track.kind = kind === StreamKind.SCREEN ? 'video' : 'audio';
      relayConsumers.current[userId] ??= {};
      relayConsumers.current[userId]![kind] = { closed: false, track };
      relayStreams.current.set(`${userId}-${kind}`, new Stream([track]));
    }
  );
  const directVideoTrack = new Track();
  directVideoTrack.kind = 'video';
  const directAudioTrack = new Track();
  const directBundle = {
    screen: new Stream([directVideoTrack]),
    screenAudio: new Stream([directAudioTrack])
  } as unknown as TDirectScreenBundle;

  await directCallbacks.prepareDirectScreenBundle(2, directBundle);

  expect(
    consumeRelay.mock.calls.map(([, kind, , options]) => ({ kind, options }))
  ).toEqual([
    {
      kind: StreamKind.SCREEN,
      options: { requestDirect: false }
    },
    {
      kind: StreamKind.SCREEN_AUDIO,
      options: { requestDirect: false }
    }
  ]);
  expect(directCallbacks.presentDirectScreenBundle(2, directBundle)).toBe(true);
});

test('joining preserves a screen watch choice made while its consumer transport is preparing', async () => {
  const ready = deferred<void>();
  consumerCreation = ready.promise;
  const initialized = initializeSession(1);
  await flush();
  voice.isViewingDemoRef.current = (id) => id === 2;
  ready.resolve();
  await initialized;
  const options = consumeExistingProducers.mock.calls[0]![1]!;
  expect(options.isViewingDemo!(2)).toBe(true);
  expect(options.isViewingDemo!(3)).toBe(false);
});

test('native group links are pairwise and a browser does not displace working peers', async () => {
  devices.directScreenSharing = true;
  peers = [
    { id: 2, state: { directMediaEnabled: true } },
    { id: 3, state: { directMediaEnabled: true } },
    { id: 4, state: { directMediaEnabled: false } }
  ];
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(directAudioStart.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  const transport = send.current!;
  const publication = await producedAt(transport, 0);
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: true });
  expect(publication.paused).toBe(false);
  peers.push({ id: 5, state: { directMediaEnabled: true } });
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(directAudioStart.mock.calls.map((call) => call[0])).toEqual([2, 3, 5]);
  expect(stopAudioPeer).not.toHaveBeenCalled();
  expect(transport.produce).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
});

test('native-only standby suppresses SFU RTP without muting shared capture', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await flush();
  const transport = send.current!;
  const publication = await producedAt(transport, 0);
  const options = transport.produce.mock.calls[0]![0];
  expect(options).toMatchObject({
    stopTracks: false,
    zeroRtpOnPause: true,
    disableTrackOnPause: false
  });
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: false });
  expect(publication.paused).toBe(true);
  const track = render().localAudioStream!.getAudioTracks()[0]!;
  expect(track.enabled).toBe(true);
  expect(track.readyState).toBe('live');
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: true });
  expect(publication.paused).toBe(false);
  expect(track.enabled).toBe(true);
});

test('browsers never attempt direct even when the preference and peers opt in', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  nativeMediaAvailable = false;
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(directAudioStart).not.toHaveBeenCalled();
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: true });
  const publication = await producedAt(send.current!, 0);
  expect(publication.paused).toBe(false);
});

test('an externally ended microphone recovers capture without rejoining voice', async () => {
  devices.noiseSuppression = NoiseSuppression.RNNOISE;
  const raw = new Stream();
  const replacement = new Stream();
  capture
    .mockImplementationOnce(async () => raw)
    .mockImplementationOnce(async () => replacement);
  await initializeSession(1);
  effects.forEach((effect) => effect());
  const currentTransport = send.current!;
  const oldContext = contexts[0]!;

  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await Bun.sleep(650);
  await flush();

  expect(capture).toHaveBeenCalledTimes(2);
  expect(send.current).toBe(currentTransport);
  expect(currentTransport.produce).toHaveBeenCalledTimes(2);
  expect(oldContext.closed).toBe(true);
  expect(contexts.at(-1)!.closed).toBe(false);
  expect(replacement.tracks[0]!.readyState).toBe('live');
  expect(render().localAudioStream?.getAudioTracks()[0]?.readyState).toBe(
    'live'
  );
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(String(render().connectionStatus)).toBe('connected');
});

test('ended-capture server cleanup names the old producer, not its replacement', async () => {
  const raw = new Stream();
  capture.mockImplementationOnce(async () => raw);
  await initializeSession(1);
  effects.forEach((effect) => effect());
  const oldProducer = await producedAt(send.current!, 0);

  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await flush();

  expect(closeProducer).toHaveBeenCalledWith({
    kind: 'audio',
    producerId: oldProducer.id
  });
  // Cancel the scheduled recovery before this fixture moves to another test.
  channelId = undefined;
  render();
  effects.forEach((effect) => effect());
});

test('microphone recovery does not wait for a pending server cleanup RPC', async () => {
  const cleanup = deferred<void>();
  closeProducer.mockImplementationOnce(() => cleanup.promise);
  const raw = new Stream();
  capture.mockImplementationOnce(async () => raw);
  await initializeSession(1);
  effects.forEach((effect) => effect());
  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await Bun.sleep(650);
  expect(closeProducer).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(2);
  const replacement = render().localAudioStream;
  expect(replacement?.getAudioTracks()[0]?.readyState).toBe('live');
  cleanup.resolve();
  await flush();
  expect(render().localAudioStream).toBe(replacement);
  expect(errorToast).not.toHaveBeenCalled();
});

test('failed automatic recovery reports the missing microphone without leaving voice', async () => {
  const raw = new Stream();
  capture
    .mockImplementationOnce(async () => raw)
    .mockImplementationOnce(async () => {
      throw new Error('Audio service unavailable');
    });
  await initializeSession(1);
  effects.forEach((effect) => effect());
  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await Bun.sleep(650);
  await flush();
  expect(errorToast).toHaveBeenCalledWith('failedRestoreMicrophone');
  expect(capture).toHaveBeenCalledTimes(2);
  expect(render().localAudioStream).toBeUndefined();
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(send.current!.closed).toBe(false);
});

test('automatic recovery preserves a muted microphone', async () => {
  micMuted = true;
  render();
  effects.forEach((effect) => effect());
  const raw = new Stream();
  capture.mockImplementationOnce(async () => raw);
  await initializeSession(1);
  effects.forEach((effect) => effect());
  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await Bun.sleep(650);
  expect(capture).toHaveBeenCalledTimes(2);
  const track = render().localAudioStream?.getAudioTracks()[0];
  expect(track?.readyState).toBe('live');
  expect(track?.enabled).toBe(false);
  expect(micMuted).toBe(true);
});

for (const mode of ['leave', 'replacement'] as const) {
  test(`${mode} cancels a scheduled microphone recovery`, async () => {
    const raw = new Stream();
    capture.mockImplementationOnce(async () => raw);
    await initializeSession(1);
    effects.forEach((effect) => effect());
    raw.tracks[0]!.readyState = 'ended';
    raw.tracks[0]!.onended?.();
    if (mode === 'replacement') await initializeSession(2);
    else {
      channelId = undefined;
      render();
      effects.forEach((effect) => effect());
    }
    const stream = render().localAudioStream;
    await Bun.sleep(650);
    expect(capture).toHaveBeenCalledTimes(mode === 'replacement' ? 2 : 1);
    expect(render().localAudioStream).toBe(stream);
    expect(errorToast).not.toHaveBeenCalled();
  });

  test(`${mode} cancels recovery while the new capture is pending`, async () => {
    const raw = new Stream();
    const pending = deferred<Stream>();
    capture
      .mockImplementationOnce(async () => raw)
      .mockImplementationOnce(() => pending.promise);
    await initializeSession(1);
    effects.forEach((effect) => effect());
    raw.tracks[0]!.readyState = 'ended';
    raw.tracks[0]!.onended?.();
    await Bun.sleep(650);
    expect(capture).toHaveBeenCalledTimes(2);
    if (mode === 'replacement') await initializeSession(2);
    else {
      channelId = undefined;
      render();
      effects.forEach((effect) => effect());
    }
    const stream = render().localAudioStream;
    const current = send.current;
    const late = new Stream();
    pending.resolve(late);
    await flush();
    expect(late.tracks[0]!.readyState).toBe('ended');
    expect(render().localAudioStream).toBe(stream);
    expect(send.current).toBe(current);
    expect(errorToast).not.toHaveBeenCalled();
  });
}

test('a manual restart superseding recovery does not show a stale failure', async () => {
  const raw = new Stream();
  const automatic = deferred<Stream>();
  const manual = deferred<Stream>();
  capture
    .mockImplementationOnce(async () => raw)
    .mockImplementationOnce(() => automatic.promise)
    .mockImplementationOnce(() => manual.promise);
  await initializeSession(1);
  effects.forEach((effect) => effect());
  raw.tracks[0]!.readyState = 'ended';
  raw.tracks[0]!.onended?.();
  await Bun.sleep(650);
  micMuted = true;
  render();
  effects.forEach((effect) => effect());
  const restart = voice.toggleMic();
  await flush();
  const stale = new Stream();
  automatic.resolve(stale);
  await flush();
  try {
    expect(capture).toHaveBeenCalledTimes(3);
    expect(stale.tracks[0]!.readyState).toBe('ended');
    expect(errorToast).not.toHaveBeenCalled();
  } finally {
    manual.resolve(new Stream());
    await restart;
  }
});

test('repeated capture termination has a bounded automatic recovery budget', async () => {
  await initializeSession(1);
  effects.forEach((effect) => effect());
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = (await capture.mock.results.at(-1)!.value) as Stream;
    raw.tracks[0]!.readyState = 'ended';
    raw.tracks[0]!.onended?.();
    await Bun.sleep(650);
    await flush();
  }
  expect(capture).toHaveBeenCalledTimes(4);
  expect(errorToast).toHaveBeenCalledWith('failedRestoreMicrophone');
  expect(render().localAudioStream).toBeUndefined();
});

test('genuine current initialization failure still leaves voice and reports failure', async () => {
  updateState.mockImplementationOnce(async () => {
    throw new Error('RPC unavailable');
  });
  await useSelectChannel()(2);
  expect(leaveVoice).toHaveBeenCalledWith({ reason: 'init_failed' });
  expect(errorToast).toHaveBeenCalledTimes(1);
  expect(render().loading).toBe(false);
  expect(String(render().connectionStatus)).toBe('failed');
});

// Exercise the real provider/caller through both outgoing media boundaries.
// Browser/transport doubles cannot prove actual Windows capture or encoder FPS.
for (const route of ['SFU', 'P2P'] as const) {
  for (const hint of ['motion', 'text', 'detail', '']) {
    test(`screen share forces the motion capture hint over '${hint}' via ${route}`, async () => {
      const video = new Track();
      video.kind = 'video';
      video.contentHint = hint;
      const stream = new Stream([video]);
      Object.assign(navigator.mediaDevices, {
        getDisplayMedia: mock(async () => stream)
      });
      devices.directScreenSharing = route === 'P2P';
      peers = route === 'P2P' ? nativePeers() : [];
      render();
      send.current = transport();
      const seenHints: string[] = [];
      send.current.produce.mockImplementation(async (...args: unknown[]) => {
        const options = args[0] as { track: Track };
        expect(options.track).toBe(video);
        seenHints.push(options.track.contentHint);
        return producer();
      });
      directStartForPeer.mockImplementation(async (_peerId, captured) => {
        expect(captured).toBe(stream);
        seenHints.push(captured.getVideoTracks()[0]!.contentHint);
        return 'direct';
      });

      await voice.toggleScreenShare();
      if (route === 'P2P') await voice.onScreenViewerStarted(2);

      const expectedHint = 'motion';
      expect(errorToast).not.toHaveBeenCalled();
      expect(seenHints).toEqual(
        route === 'P2P' ? [expectedHint, expectedHint] : [expectedHint]
      );
      expect(video.contentHint).toBe(expectedHint);
      expect(video.readyState).toBe('live');
      expect(send.current.produce).toHaveBeenCalledTimes(1);
    });
  }
}

test('native P2P setup failure falls back to the SFU producer', async () => {
  const video = new Track();
  video.kind = 'video';
  const stream = new Stream([video]);
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: mock(async () => stream)
  });
  devices.directScreenSharing = true;
  peers = nativePeers();
  render();
  send.current = transport();
  const direct = new DirectMedia({
    kind: StreamKind.SCREEN,
    prepare: async (_peerId, _signal) => ({
      kind: StreamKind.SCREEN,
      sessionId: 'strict-direct',
      peerId: 2,
      transport: 'holepunch',
      iceServers: []
    }),
    send: async () => {},
    onStream() {},
    onRemoveStream() {},
    prepareScreenBundle: async () => {},
    presentScreenBundle: () => true,
    retireScreenBundle: () => {},
    onStatus() {},
    onError() {}
  });
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    'RTCPeerConnection'
  );
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: undefined
  });
  directStartForPeer.mockImplementation((peerId, captured, options) =>
    direct.startForPeer(peerId, captured as unknown as MediaStream, options)
  );
  try {
    await voice.toggleScreenShare();
    await voice.onScreenViewerStarted(2);
    expect(send.current.produce).toHaveBeenCalledTimes(1);
    expect(errorToast).not.toHaveBeenCalled();
    expect(video.readyState).toBe('live');
    expect(updateState).toHaveBeenLastCalledWith({ sharingScreen: true });
  } finally {
    direct.close();
    if (previous)
      Object.defineProperty(globalThis, 'RTCPeerConnection', previous);
    else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  }
});

test('established P2P failure keeps the already published relay share', async () => {
  const video = new Track();
  video.kind = 'video';
  const stream = new Stream([video]);
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: mock(async () => stream)
  });
  devices.directScreenSharing = true;
  peers = nativePeers();
  render();
  effects.forEach((effect) => effect());
  send.current = transport();
  let fail!: (relayAllowed: boolean, peerId: number) => Promise<void>;
  directStartForPeer.mockImplementation(async (_peerId, _stream, options) => {
    fail = options.onFailure;
    return 'direct';
  });
  await voice.toggleScreenShare();
  await voice.onScreenViewerStarted(2);
  await fail(true, 2);
  expect(send.current.produce).toHaveBeenCalledTimes(1);
  expect(video.readyState).toBe('live');
  expect(errorToast).not.toHaveBeenCalled();
});

test('leaving while capture is pending resets loading without replacement', async () => {
  const pending = deferred<Stream>();
  capture.mockImplementationOnce(() => pending.promise);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  expect(render().loading).toBe(true);
  // Establish the channel observer, then deliver the real leave transition.
  effects.forEach((effect) => effect());
  channelId = undefined;
  render();
  effects.forEach((effect) => effect());
  expect(render().loading).toBe(false);
  const stream = new Stream();
  pending.resolve(stream);
  await old;
  expect(render().loading).toBe(false);
  expect(stream.tracks[0]!.readyState).toBe('ended');
});

test('leave immediately stops acquired microphone and closes pending gate context', async () => {
  devices.noiseGateEnabled = true;
  const raw = new Stream();
  capture.mockImplementationOnce(async () => raw);
  const pending = deferred<Awaited<ReturnType<typeof gate>>>();
  const node = { connect() {}, disconnect: mock(() => {}) };
  gate.mockImplementationOnce(() => pending.promise);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  effects.forEach((effect) => effect());
  channelId = undefined;
  render();
  effects.forEach((effect) => effect());
  expect(render().loading).toBe(false);
  expect(raw.tracks[0]!.readyState).toBe('ended');
  expect(contexts[0]!.closed).toBe(true);
  pending.resolve(node);
  await old;
  expect(node.disconnect).toHaveBeenCalled();
});

for (const mode of ['leave', 'replacement'] as const) {
  test(`${mode} immediately disposes resources during pending suppression`, async () => {
    devices.noiseGateEnabled = true;
    devices.noiseSuppression = NoiseSuppression.RNNOISE;
    const raw = new Stream();
    capture.mockImplementationOnce(async () => raw);
    const pending = deferred<Awaited<ReturnType<typeof suppress>>>();
    const nsContext = new Context();
    suppress.mockImplementationOnce((_type, _stream, register) => {
      register?.(nsContext as unknown as AudioContext);
      return pending.promise;
    });
    const old = voice.init({}, 1).catch(() => {});
    await flush();
    const gateContext = contexts[1]!;
    if (mode === 'replacement') {
      await initializeSession(2);
    } else {
      effects.forEach((effect) => effect());
      channelId = undefined;
      render();
      effects.forEach((effect) => effect());
    }
    expect(raw.tracks[0]!.readyState).toBe('ended');
    expect(gateContext.closed).toBe(true);
    expect(gateContext.output.tracks[0]!.readyState).toBe('ended');
    expect(nsContext.closed).toBe(true);
    const current = send.current;
    const stream = render().localAudioStream;
    pending.resolve({
      contexts: [nsContext],
      outputTrack: nsContext.output.tracks[0]!
    });
    await old;
    expect(nsContext.output.tracks[0]!.readyState).toBe('ended');
    expect(send.current).toBe(current);
    expect(render().localAudioStream).toBe(stream);
    if (mode === 'replacement') {
      expect(current!.closed).toBe(false);
      expect(contexts[2]!.closed).toBe(false);
      expect(contexts[3]!.closed).toBe(false);
    }
  });
}

test('cancelled startup disposes each context once even when close rejects', async () => {
  devices.noiseGateEnabled = true;
  const pending = deferred<Awaited<ReturnType<typeof gate>>>();
  gate.mockImplementationOnce(() => pending.promise);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  const context = contexts[0]!;
  context.rejectClose = true;
  await initializeSession(2);
  pending.resolve({ connect() {}, disconnect: mock(() => {}) });
  await old;
  await flush();
  expect(context.closeCalls).toBe(1);
  expect(send.current!.closed).toBe(false);
});

test('cancelled A caller never leaves B after late microphone processing', async () => {
  devices.noiseGateEnabled = true;
  const pending = deferred<Awaited<ReturnType<typeof gate>>>();
  const node = { connect() {}, disconnect: mock(() => {}) };
  gate.mockImplementationOnce(() => pending.promise);
  const select = useSelectChannel();
  const old = select(2);
  await flush();
  await select(3);
  const current = send.current!;
  const stream = render().localAudioStream;
  pending.resolve(node);
  await old;
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(errorToast).not.toHaveBeenCalled();
  expect(current.produce).toHaveBeenCalledTimes(1);
  expect(render().localAudioStream).toBe(stream);
  expect(contexts[0]!.closed).toBe(true);
  expect(contexts[1]!.closed).toBe(false);
});

test('cancelled A caller never leaves B on late capture rejection', async () => {
  const pending = deferred<Stream>();
  capture.mockImplementationOnce(() => pending.promise);
  const select = useSelectChannel();
  const old = select(2);
  await flush();
  await select(3);
  const current = send.current!;
  pending.reject(new Error('capture failed'));
  await old;
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(errorToast).not.toHaveBeenCalled();
  expect(current.closed).toBe(false);
  expect(String(render().connectionStatus)).toBe('connected');
});

test('cancelled A caller preserves B loading during deferred B capture', async () => {
  const a = deferred<Stream>();
  const b = deferred<Stream>();
  capture
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);
  const select = useSelectChannel();
  const old = select(2);
  await flush();
  const replacement = select(3);
  await flush();
  const current = send.current!;
  a.reject(new Error('old capture rejected'));
  await old;
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(render().loading).toBe(true);
  expect(current.closed).toBe(false);
  b.resolve(new Stream());
  await replacement;
  expect(render().loading).toBe(false);
  expect(current.produce).toHaveBeenCalledTimes(1);
});

test('cancelled A caller preserves B loading during deferred B processing', async () => {
  devices.noiseGateEnabled = true;
  const a = deferred<Awaited<ReturnType<typeof gate>>>();
  const b = deferred<Awaited<ReturnType<typeof gate>>>();
  gate
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);
  const select = useSelectChannel();
  const old = select(2);
  await flush();
  const replacement = select(3);
  await flush();
  const current = send.current!;
  a.resolve({ connect() {}, disconnect: mock(() => {}) });
  await old;
  expect(leaveVoice).not.toHaveBeenCalled();
  expect(render().loading).toBe(true);
  expect(current.produce).not.toHaveBeenCalled();
  expect(contexts[0]!.closed).toBe(true);
  expect(contexts[1]!.closed).toBe(false);
  b.resolve({ connect() {}, disconnect: mock(() => {}) });
  await replacement;
  expect(render().loading).toBe(false);
  expect(current.produce).toHaveBeenCalledTimes(1);
});

test('late A processing disposes its graph without overwriting B', async () => {
  devices.noiseGateEnabled = true;
  const pending = deferred<Awaited<ReturnType<typeof gate>>>();
  const node = { connect() {}, disconnect: mock(() => {}) };
  gate.mockImplementationOnce(() => pending.promise);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  const oldContext = contexts[0]!;
  await initializeSession(2);
  expect(oldContext.closed).toBe(true);
  const current = send.current!;
  const bStream = render().localAudioStream;
  pending.resolve(node);
  await old;
  expect(current.produce).toHaveBeenCalledTimes(1);
  expect(render().localAudioStream).toBe(bStream);
  expect(oldContext.closed).toBe(true);
  expect(node.disconnect).toHaveBeenCalled();
  expect(contexts[1]!.closed).toBe(false);
});

for (const mode of ['leave', 'replacement'] as const) {
  for (const result of ['resolve', 'reject'] as const) {
    test(`late native produce ${result} after ${mode} stays isolated`, async () => {
      const pending = deferred<ReturnType<typeof producer>>();
      nextProduction = pending.promise;
      const raw = new Stream();
      capture.mockImplementationOnce(async () => raw);
      const select = useSelectChannel();
      const old = select(2);
      await flush();
      const oldTransport = send.current!;
      expect(oldTransport.produce).toHaveBeenCalledTimes(1);
      if (mode === 'replacement') {
        await select(3);
      } else {
        effects.forEach((effect) => effect());
        channelId = undefined;
        render();
        effects.forEach((effect) => effect());
      }
      expect(raw.tracks[0]!.readyState).toBe('ended');
      expect(oldTransport.closed).toBe(true);
      const current = send.current;
      const stream = render().localAudioStream;
      const late = producer();
      if (result === 'resolve') pending.resolve(late);
      else pending.reject(new Error('native produce failed'));
      await old;
      if (result === 'resolve') expect(late.close).toHaveBeenCalledTimes(1);
      expect(leaveVoice).not.toHaveBeenCalled();
      expect(errorToast).not.toHaveBeenCalled();
      expect(send.current).toBe(current);
      expect(render().localAudioStream).toBe(stream);
      expect(render().loading).toBe(false);
      if (current) expect(current.closed).toBe(false);
    });
  }
}

test('late A completion keeps B pending disposer registered for leave', async () => {
  devices.noiseGateEnabled = true;
  const a = deferred<Awaited<ReturnType<typeof gate>>>();
  const b = deferred<Awaited<ReturnType<typeof gate>>>();
  gate
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);
  const rawA = new Stream();
  const rawB = new Stream();
  capture
    .mockImplementationOnce(async () => rawA)
    .mockImplementationOnce(async () => rawB);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  const replacement = initializeSession(2).catch(() => {});
  await flush();
  expect(rawA.tracks[0]!.readyState).toBe('ended');
  expect(contexts[0]!.closed).toBe(true);
  expect(rawB.tracks[0]!.readyState).toBe('live');
  expect(contexts[1]!.closed).toBe(false);
  a.resolve({ connect() {}, disconnect: mock(() => {}) });
  await old;
  effects.forEach((effect) => effect());
  channelId = undefined;
  render();
  effects.forEach((effect) => effect());
  expect(rawB.tracks[0]!.readyState).toBe('ended');
  expect(contexts[1]!.closed).toBe(true);
  const lateB = { connect() {}, disconnect: mock(() => {}) };
  b.resolve(lateB);
  await replacement;
  expect(lateB.disconnect).toHaveBeenCalled();
});

test('late A capture cannot publish into B or replace B microphone', async () => {
  const pending = deferred<Stream>();
  const a = new Stream();
  const b = new Stream();
  capture
    .mockImplementationOnce(() => pending.promise)
    .mockImplementationOnce(async () => b);
  const old = voice.init({}, 1).catch(() => {});
  await flush();
  await initializeSession(2);
  const current = send.current!;
  pending.resolve(a);
  await old;
  expect(current.produce).toHaveBeenCalledTimes(1);
  expect(render().localAudioStream).toBe(
    contexts.at(-1)!.output as unknown as MediaStream
  );
  expect(a.tracks[0]!.readyState).toBe('ended');
  expect(b.tracks[0]!.readyState).toBe('live');
});

test('a failed microphone pair does not restart a working pair or recapture', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await flush();
  const failure = directAudioStart.mock.calls[0]![2].onFailure;
  await failure(true, 2);
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: true });
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(directAudioStart.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  expect(stopAudioPeer).not.toHaveBeenCalledWith(3);
  expect(send.current!.produce).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledTimes(1);
  const publication = await producedAt(send.current!, 0);
  expect(publication.paused).toBe(false);
  expect(render().localAudioStream?.getAudioTracks()[0]?.readyState).toBe(
    'live'
  );
});

test('voice-only peers receive microphone but not webcam direct links', async () => {
  devices.directScreenSharing = true;
  peers = [
    { id: 2, state: { directMediaEnabled: true, voiceOnlyMode: true } },
    { id: 3, state: { directMediaEnabled: true } }
  ];
  await initializeSession(1);
  const video = new Track();
  video.kind = 'video';
  capture.mockImplementationOnce(async () => new Stream([video]));
  await voice.toggleWebcam();
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(directAudioStart.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  expect(directVideoStart.mock.calls.map((call) => call[0])).toEqual([3]);
  expect(video.readyState).toBe('live');
});

test('a removed native peer stops only its own microphone link', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await flush();
  peers = [peers[1]!];
  render();
  effects.forEach((effect) => effect());
  await flush();
  expect(stopAudioPeer.mock.calls.map((call) => call[0])).toEqual([2]);
  expect(directAudioStart.mock.calls.map((call) => call[0])).toEqual([2, 3]);
  expect(capture).toHaveBeenCalledTimes(1);
});

test('late relay audio cannot replace an active direct microphone stream', async () => {
  await initializeSession(1);
  const direct = new Stream();
  directCallbacks.addRemoteUserStream(
    2,
    direct as unknown as MediaStream,
    StreamKind.AUDIO
  );
  const relay = new Stream();
  transportCallbacks.addRemoteUserStream(
    2,
    relay as unknown as MediaStream,
    StreamKind.AUDIO
  );
  expect(relay.tracks[0]!.readyState).toBe('ended');
  expect(render().remoteUserStreams[2]?.audio).toBe(
    direct as unknown as MediaStream
  );
  const replacement = new Stream();
  directCallbacks.addRemoteUserStream(
    2,
    replacement as unknown as MediaStream,
    StreamKind.AUDIO
  );
  directCallbacks.removeRemoteUserStream(
    2,
    StreamKind.AUDIO,
    direct as unknown as MediaStream
  );
  expect(render().remoteUserStreams[2]?.audio).toBe(
    replacement as unknown as MediaStream
  );
});

test('screen video and screen audio standby follow relay viewers independently', async () => {
  devices.directScreenSharing = true;
  peers = nativePeers();
  const video = new Track();
  video.kind = 'video';
  const audio = new Track();
  const stream = new Stream([video, audio]);
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: async () => stream
  });
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  await voice.toggleScreenShare();
  await voice.onScreenViewerStarted(2);
  const videoProducer = await producedAt(send.current!, 1);
  const audioProducer = await producedAt(send.current!, 2);
  expect(videoProducer.paused).toBe(true);
  expect(audioProducer.paused).toBe(true);
  relayDemand({ channelId: 1, kind: StreamKind.SCREEN, required: true });
  relayDemand({ channelId: 1, kind: StreamKind.SCREEN_AUDIO, required: true });
  expect(videoProducer.paused).toBe(false);
  expect(audioProducer.paused).toBe(false);
  relayDemand({ channelId: 1, kind: StreamKind.SCREEN, required: false });
  expect(videoProducer.paused).toBe(true);
  expect(audioProducer.paused).toBe(false);
  expect(video.enabled).toBe(true);
  expect(audio.enabled).toBe(true);
  expect(video.readyState).toBe('live');
  expect(audio.readyState).toBe('live');
  expect(directStartForPeer.mock.calls.map((call) => call[0])).toEqual([2]);
});

test('relay demand subscription failure resumes paused publishers and future captures', async () => {
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  const microphone = await producedAt(send.current!, 0);
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: false });
  expect(microphone.paused).toBe(true);
  relayDemandError(new Error('demand channel lost'));
  expect(microphone.paused).toBe(false);
  const video = new Track();
  video.kind = 'video';
  capture.mockImplementationOnce(async () => new Stream([video]));
  await voice.toggleWebcam();
  const camera = await producedAt(send.current!, 1);
  expect(camera.paused).toBe(false);
  relayDemand({ channelId: 1, kind: StreamKind.VIDEO, required: false });
  expect(camera.paused).toBe(true);
});

test('retired demand callbacks cannot pause or resume a replacement voice session', async () => {
  await initializeSession(1);
  render();
  effects.forEach((effect) => effect());
  const oldDemand = relayDemand;
  const oldError = relayDemandError;
  relayDemand({ channelId: 1, kind: StreamKind.AUDIO, required: false });
  await initializeSession(1);
  const microphone = await producedAt(send.current!, 0);
  expect(microphone.paused).toBe(false);
  oldDemand({ channelId: 1, kind: StreamKind.AUDIO, required: false });
  expect(microphone.paused).toBe(false);
  render();
  effects.forEach((effect) => effect());
  expect(microphone.paused).toBe(true);
  oldError(new Error('retired subscription'));
  expect(microphone.paused).toBe(true);
});
