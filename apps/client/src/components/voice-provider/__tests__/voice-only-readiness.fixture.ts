import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import * as React from 'react';
import * as ActualI18n from 'react-i18next';
import * as ActualSonner from 'sonner';
import type { TDevicesProvider } from '../../devices-provider';

let activeHarness: HookHarness | undefined;
const contextValues = new Map<object, unknown>();
type HookHarness = {
  slots: unknown[];
  cursor: number;
  pendingEffects: { run: () => void | (() => void) }[];
};
const nextHook = () => {
  if (!activeHarness) throw new Error('Hook called outside the harness');
  return activeHarness.cursor++;
};
const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !!a &&
  !!b &&
  a.length === b.length &&
  a.every((value, i) => Object.is(value, b[i]));
mock.module('react', () => ({
  ...React,
  memo: <T>(value: T) => value,
  useRef: <T>(initial: T) => {
    const index = nextHook();
    const harness = activeHarness!;
    return (harness.slots[index] ??= {
      current: initial
    }) as React.MutableRefObject<T>;
  },
  useState: <T>(initial: T | (() => T)) => {
    const index = nextHook();
    const harness = activeHarness!;
    if (!(index in harness.slots)) {
      harness.slots[index] =
        typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    return [
      harness.slots[index] as T,
      (next: T | ((current: T) => T)) => {
        const current = harness.slots[index] as T;
        harness.slots[index] =
          typeof next === 'function'
            ? (next as (current: T) => T)(current)
            : next;
      }
    ] as const;
  },
  useCallback: <T extends (...args: never[]) => unknown>(
    callback: T,
    deps: unknown[]
  ) => {
    const index = nextHook();
    const harness = activeHarness!;
    const prior = harness.slots[index] as
      { deps: unknown[]; value: T } | undefined;
    if (!prior || !sameDeps(prior.deps, deps))
      harness.slots[index] = { deps, value: callback };
    return (harness.slots[index] as { deps: unknown[]; value: T }).value;
  },
  useMemo: <T>(factory: () => T, deps: unknown[]) => {
    const index = nextHook();
    const harness = activeHarness!;
    const prior = harness.slots[index] as
      { deps: unknown[]; value: T } | undefined;
    if (!prior || !sameDeps(prior.deps, deps))
      harness.slots[index] = { deps, value: factory() };
    return (harness.slots[index] as { deps: unknown[]; value: T }).value;
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = nextHook();
    const harness = activeHarness!;
    const prior = harness.slots[index] as
      { deps?: unknown[]; cleanup?: () => void } | undefined;
    if (prior && deps && sameDeps(prior.deps, deps)) return;
    harness.slots[index] = { deps, cleanup: prior?.cleanup };
    harness.pendingEffects.push({
      run: () => {
        const current = harness.slots[index] as {
          deps?: unknown[];
          cleanup?: () => void;
        };
        current.cleanup?.();
        current.cleanup = effect() || undefined;
      }
    });
  },
  useContext: (context: object & { _currentValue?: unknown }) =>
    contextValues.has(context)
      ? contextValues.get(context)
      : context._currentValue
}));

const makeHarness = (): HookHarness => ({
  slots: [],
  cursor: 0,
  pendingEffects: []
});
const renderWithHooks = <T>(harness: HookHarness, render: () => T) => {
  harness.cursor = 0;
  harness.pendingEffects = [];
  activeHarness = harness;
  try {
    return { value: render(), effects: harness.pendingEffects };
  } finally {
    activeHarness = undefined;
  }
};
const commitEffects = (effects: { run: () => void | (() => void) }[]) => {
  effects.forEach(({ run }) => run());
};
const unmountHarness = (harness: HookHarness) => {
  for (const slot of harness.slots) {
    if (
      slot &&
      typeof slot === 'object' &&
      'cleanup' in slot &&
      typeof slot.cleanup === 'function'
    )
      slot.cleanup();
  }
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
const storage = new MemoryStorage();
let channelId: number | undefined;
let serverChannelId: number | undefined;
let enumeration: Promise<MediaDeviceInfo[]> = Promise.resolve([]);
let joinResult: Promise<unknown> = Promise.resolve({});
const updateCalls: { channelId: number | undefined; voiceOnlyMode: boolean }[] =
  [];
const serverModes = new Map<number, boolean>();
const recordUpdate = (state: { voiceOnlyMode: boolean }) => {
  updateCalls.push({
    channelId: serverChannelId,
    voiceOnlyMode: state.voiceOnlyMode
  });
  if (serverChannelId !== undefined)
    serverModes.set(serverChannelId, state.voiceOnlyMode);
};
const updateState = mock(async (state: { voiceOnlyMode: boolean }) => {
  recordUpdate(state);
});
const leaveVoice = mock(async () => {});
mock.module('@/features/server/channels/hooks', () => ({
  useChannels: () => [],
  useChannelById: (id: number) => ({ id, type: 'voice' }),
  useChannelsByCategoryId: () => [],
  useChannelIdsByCategory: () => ({}),
  useSelectedChannelId: () => undefined,
  useCurrentVoiceChannelId: () => channelId,
  useIsCurrentVoiceChannelSelected: () => false,
  useChannelPermissionsById: () => ({}),
  useSelectedChannelType: () => undefined,
  useChannelsMap: () => ({}),
  useDirectMessagesUnreadCount: () => 0
}));
mock.module('@/features/server/channels/actions', () => ({
  setSelectedChannelId() {}
}));
mock.module('@/features/server/channels/selectors', () => ({
  channelByIdSelector: (_state: unknown, id: number) => ({ id, type: 'VOICE' }),
  channelsSelector: () => [],
  selectedChannelIdSelector: () => undefined,
  selectedChannelTypeSelector: () => undefined,
  currentVoiceChannelIdSelector: () => channelId,
  channelPermissionsSelector: () => ({}),
  channelsReadStatesSelector: () => ({}),
  channelReadStateByIdSelector: () => 0,
  channelsMapSelector: () => ({}),
  channelsByCategoryIdSelector: () => [],
  channelIdsByCategorySelector: () => ({}),
  isCurrentVoiceChannelSelectedSelector: () => false,
  isChannelTextVisibleByIdSelector: () => false,
  channelPermissionsByIdSelector: () => ({}),
  directMessagesUnreadCountSelector: () => 0
}));
mock.module('@/features/server/hooks', () => ({
  useIsConnected: () => false,
  useIsReconnecting: () => false,
  useReconnectState: () => undefined,
  useDisconnectInfo: () => undefined,
  useServerName: () => '',
  useTotalUnreadCount: () => 0,
  usePublicServerSettings: () => ({}),
  useWebRtcSimulcastEnabled: () => false,
  useCurrentVoicePeers: () => [],
  useOwnUserRoles: () => [],
  useHiddenPluginComponents: () => [],
  useInfo: () => ({}),
  useIsOwnUserOwner: () => false,
  useReferenceableChannels: () => [],
  usePluginsEnabled: () => false,
  useCan: () => () => false,
  useChannelCan: () => () => false,
  useHasVisibleChannelsInCategory: () => false,
  useUserRoles: () => [],
  useTypingUsersByChannelId: () => [],
  useTypingUsersByThreadId: () => [],
  useVoiceUsersByChannelId: () => [],
  useOwnVoiceUser: () => undefined,
  useUnreadMessagesCount: () => 0,
  useCategoryUnreadMessagesCount: () => 0,
  useCategoryHasUnreadMentions: () => false,
  useCategoryUnreadData: () => ({ unreadCount: 0, hasUnreadMentions: false }),
  useHasSharingScreenUsers: () => false,
  useHasUnreadMentions: () => false,
  useActiveFullscreenPluginId: () => undefined,
  useDmsOpen: () => false,
  useUserSettingsPlugins: () => []
}));
mock.module('@/features/server/voice/actions', () => ({
  addUserToVoiceChannel() {},
  removeUserFromVoiceChannel() {},
  addExternalStreamToVoiceChannel() {},
  updateExternalStreamInVoiceChannel() {},
  removeExternalStreamFromVoiceChannel() {},
  updateVoiceUserState() {},
  showVoiceReaction() {},
  updateOwnVoiceState() {},
  joinVoice: (id: number) => {
    channelId = id;
    return joinResult;
  },
  leaveVoice,
  setVoiceMoveTargetChannelId() {},
  setPinnedCard() {},
  setHideNonVideoParticipants() {},
  setShowUserBannersInVoice() {},
  setHideOwnScreenShare() {}
}));
mock.module('@/features/server/voice/hooks', () => ({
  useVoiceChannelExternalStreamsList: () => [],
  useVoiceChannelAudioExternalStreams: () => [],
  useVoice: () => voice,
  useOwnVoiceState: () => ({
    micMuted: false,
    soundMuted: false,
    webcamEnabled: false,
    sharingScreen: false
  }),
  usePinnedCard: () => undefined,
  useVoiceMoveTargetChannelId: () => undefined,
  useVoiceReactions: () => [],
  useHideNonVideoParticipants: () => false,
  useShowUserBannersInVoice: () => false,
  useHideOwnScreenShare: () => false,
  useSpeakingState: () => ({ isActivelySpeaking: false, speakingIntensity: 0 })
}));
mock.module('@/features/store', () => ({
  store: { getState: () => ({}), dispatch() {} },
  useStoreSelector: (selector: (state: unknown) => unknown) => selector({})
}));
mock.module('@/helpers/audio-gate', () => ({
  clampMicrophoneDecibels: (value: number) => value,
  MICROPHONE_GATE_CLOSE_HOLD_MS: 200,
  MICROPHONE_GATE_DEFAULT_THRESHOLD_DB: -45
}));
mock.module('@/helpers/audio-worklet/noise-gate-worklet', () => ({
  createNoiseGateWorkletNode: async () => ({ connect() {}, disconnect() {} }),
  getNoiseGateWorkletAvailabilitySnapshot: () => ({ available: false }),
  markNoiseGateWorkletUnavailable() {},
  postNoiseGateWorkletConfig() {}
}));
mock.module('@/helpers/audio-worklet/ns-worklet', () => ({
  createNsChain: async (_type: unknown, stream: Stream) => ({
    contexts: [],
    outputTrack: stream.getAudioTracks()[0]!
  })
}));
mock.module('@/helpers/sounds', () => ({ playSound() {} }));
mock.module('@/helpers/browser-logger', () => ({
  logDebug() {},
  logVoice() {},
  logVoiceWarn() {},
  logVoiceError() {}
}));
mock.module('@/helpers/voice-debug', () => ({
  clearVoiceDebugEvents() {},
  collectVoiceDebugSnapshot: () => ({}),
  getVoiceDebugEvents: () => [],
  pushVoiceDebugEvent() {},
  registerVoiceDebugSource: () => () => {}
}));
mock.module('@/helpers/get-display-media-support', () => ({
  getRestrictOwnAudioSupport: () => false,
  getSuppressLocalAudioPlaybackSupport: () => false
}));
mock.module('@/helpers/get-res-with-height', () => ({
  getResWidthHeight: () => ({ width: 1280, height: 720 })
}));
mock.module('@/hooks/use-screen-share-support', () => ({
  useScreenShareSupport: () => ({ isScreenShareSupported: false })
}));
const createTrpcClient = (mutate = updateState) => ({
  voice: {
    updateState: { mutate },
    onRelayDemand: { subscribe: () => ({ unsubscribe() {} }) },
    closeProducer: { mutate: async () => {} }
  }
});
let trpcClient = createTrpcClient();
mock.module('@/lib/trpc', () => ({
  cleanup() {},
  connectToTRPC: async () => {},
  getTRPCClient: () => trpcClient
}));
const translation = (key: string) => key;
mock.module('react-i18next', () => ({
  ...ActualI18n,
  useTranslation: () => ({ t: translation })
}));
mock.module('sonner', () => ({
  ...ActualSonner,
  toast: { error() {}, info() {} }
}));
mock.module('mediasoup-client', () => ({
  Device: class {
    rtpCapabilities = { codecs: [] };
    async load() {}
  }
}));
const directMediaStub = () => ({
  start: async () => 'relay' as const,
  close() {},
  stop() {},
  getConnections: () => [],
  acceptPendingOffer() {},
  stopReceiving() {}
});
mock.module('../hooks/use-direct-media', () => ({
  useDirectMedia: () => ({
    directMedia: {
      audio: directMediaStub(),
      video: directMediaStub(),
      screen: directMediaStub()
    }
  })
}));
mock.module('../hooks/use-transport-stats', () => ({
  useTransportStats: () => ({
    startMonitoring() {},
    stopMonitoring() {},
    resetStats() {},
    setScreenShareProducer() {},
    transportStats: {},
    subscribeToStats: () => () => {}
  })
}));
const generation = { current: 0 };
const producerTransport: { current?: Transport } = {};
const consumerTransport: { current?: Transport } = {};
type Transport = {
  closed: boolean;
  close: () => void;
  produce: () => Promise<Producer>;
};
type Producer = {
  id: string;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  close: () => void;
  observer: { on: () => void };
};
const makeTransport = (): Transport => ({
  closed: false,
  close() {
    this.closed = true;
  },
  produce: async () => {
    const publication: Producer = {
      id: 'audio-producer',
      paused: false,
      pause() {
        publication.paused = true;
      },
      resume() {
        publication.paused = false;
      },
      close() {},
      observer: { on() {} }
    };
    return publication;
  }
});
mock.module('../hooks/use-transports', () => ({
  useTransports: () => ({
    producerTransport,
    consumerTransport,
    sessionGenerationRef: generation,
    consumers: { current: {} },
    consumerStreams: { current: new Map() },
    consumeOperationsInProgress: { current: new Map() },
    createProducerTransport: async () => {
      producerTransport.current = makeTransport();
    },
    createConsumerTransport: async () => {
      consumerTransport.current = makeTransport();
    },
    consumeRef: { current: null },
    consumeExistingProducers: async () => {},
    cleanupTransports: () => {
      generation.current++;
      producerTransport.current?.close();
      consumerTransport.current?.close();
      producerTransport.current = consumerTransport.current = undefined;
    },
    getConsumer() {},
    getConsumerCodec() {},
    markDemoConsumersPaused() {},
    pauseDemoConsumers() {},
    closeConsumer() {},
    closeConsumers() {}
  })
}));

class Track {
  kind = 'audio';
  contentHint = '';
  id = 'mic-track';
  label = 'Microphone';
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
  constructor(public tracks: Track[] = [new Track()]) {}
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

Object.assign(globalThis, {
  window: { addEventListener() {}, location: { protocol: 'http:' } },
  localStorage: storage,
  navigator: {
    mediaDevices: {
      enumerateDevices: async () => [],
      getUserMedia: async () => new Stream()
    }
  }
});

const { DevicesProvider, DevicesProviderContext } =
  await import('../../devices-provider');
const { VoiceProvider } = await import('../index');
const { useSelectChannel } = await import('@/hooks/use-select-channel');
const { LocalStorageKey } = await import('@/helpers/storage');
let devicesHarness = makeHarness();
let voiceHarness = makeHarness();
let channelSelectionHarness = makeHarness();
let deviceContext: TDevicesProvider;
let voice: import('../index').TVoiceProvider;
const renderDevices = () => {
  const rendered = renderWithHooks(devicesHarness, () =>
    (
      DevicesProvider as unknown as (props: {
        children: null;
      }) => React.ReactElement
    )({ children: null })
  );
  const value = (
    rendered.value as React.ReactElement<{
      value: TDevicesProvider;
    }>
  ).props.value;
  contextValues.set(DevicesProviderContext, value);
  deviceContext = value;
  commitEffects(rendered.effects);
  return value;
};
const renderVoice = () => {
  const rendered = renderWithHooks(voiceHarness, () =>
    (
      VoiceProvider as unknown as (props: {
        children: null;
      }) => React.ReactElement<{ value: import('../index').TVoiceProvider }>
    )({ children: null })
  );
  voice = rendered.value.props.value;
  commitEffects(rendered.effects);
  return voice;
};
const storedSettings = () =>
  JSON.parse(
    storage.getItem(LocalStorageKey.DEVICES_SETTINGS) || '{}'
  ) as Record<string, unknown>;
const setDevicesSettings = (settings: Record<string, unknown>) =>
  storage.setItem(LocalStorageKey.DEVICES_SETTINGS, JSON.stringify(settings));
const device = (
  deviceId: string,
  kind: MediaDeviceKind,
  label: string
): MediaDeviceInfo => ({
  deviceId,
  groupId: `${deviceId}-group`,
  kind,
  label,
  toJSON: () => ({})
});

beforeEach(() => {
  storage.clear();
  channelId = 1;
  serverChannelId = 1;
  enumeration = Promise.resolve([]);
  joinResult = Promise.resolve({});
  updateCalls.length = 0;
  serverModes.clear();
  updateState.mockReset();
  updateState.mockImplementation(async (state) => {
    recordUpdate(state);
  });
  trpcClient = createTrpcClient();
  leaveVoice.mockClear();
  generation.current = 0;
  producerTransport.current = consumerTransport.current = undefined;
  devicesHarness = makeHarness();
  voiceHarness = makeHarness();
  channelSelectionHarness = makeHarness();
  const storageValue = {
    getItem: storage.getItem.bind(storage),
    setItem: storage.setItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    clear: storage.clear.bind(storage)
  };
  Object.assign(globalThis, {
    localStorage: storageValue,
    MediaStream: Stream,
    window: {
      AudioContext: class {
        close() {
          return Promise.resolve();
        }
      }
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices: () => enumeration,
        getUserMedia: async () => new Stream(),
        addEventListener() {},
        removeEventListener() {}
      }
    }
  });
});
afterEach(() => {
  contextValues.clear();
});

const startVoiceProvider = () => {
  renderVoice();
  return voice;
};
const initializeSession = async (id: number) => {
  channelId = id;
  serverChannelId = id;
  const currentVoice = startVoiceProvider();
  await currentVoice.init({}, id);
  return renderVoice();
};

// These race tests exercise the real VoiceProvider, DevicesProvider and useDevices hook.
test('a toggle during a replacement join waits until the real session initialization completes', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  const oldModeWrite = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return oldModeWrite.promise;
  });
  const currentVoice = startVoiceProvider();
  const oldInit = currentVoice.init({}, 1).catch((error) => error);
  await flush();
  expect(updateCalls).toEqual([{ channelId: 1, voiceOnlyMode: false }]);

  channelId = undefined;
  renderVoice();
  const pendingJoin = deferred<unknown>();
  joinResult = pendingJoin.promise;
  const selectChannel = renderWithHooks(channelSelectionHarness, () =>
    useSelectChannel()
  ).value;
  const joining = selectChannel(2);
  renderVoice();
  expect<number | undefined>(channelId).toBe(2);

  const setMode = voice.setVoiceOnlyMode(true);
  await flush();
  oldModeWrite.resolve();
  await oldInit;
  expect(updateCalls).toEqual([{ channelId: 1, voiceOnlyMode: false }]);
  expect(storedSettings().voiceOnlyMode).toBe(false);

  serverChannelId = 2;
  const pendingCapture = deferred<Stream>();
  Object.assign(navigator.mediaDevices, {
    getUserMedia: () => pendingCapture.promise
  });
  pendingJoin.resolve({});
  await flush();
  expect(updateCalls).toEqual([
    { channelId: 1, voiceOnlyMode: false },
    { channelId: 2, voiceOnlyMode: false }
  ]);
  expect(storedSettings().voiceOnlyMode).toBe(false);

  pendingCapture.resolve(new Stream());
  await joining;
  expect(await setMode).toBe(true);
  expect(updateCalls).toEqual([
    { channelId: 1, voiceOnlyMode: false },
    { channelId: 2, voiceOnlyMode: false },
    { channelId: 2, voiceOnlyMode: true }
  ]);
  expect(storedSettings().voiceOnlyMode).toBe(true);
});

test('a pending init mode write finishes before toggle confirmation and latest device settings survive enumeration', async () => {
  setDevicesSettings({
    voiceOnlyMode: false,
    microphoneId: 'mic-1',
    noiseGateThresholdDb: -40
  });
  const pendingEnumeration = deferred<MediaDeviceInfo[]>();
  enumeration = pendingEnumeration.promise;
  renderDevices();
  const initModeWrite = deferred<void>();
  const toggleWrite = deferred<void>();
  updateState
    .mockImplementationOnce((state) => {
      recordUpdate(state);
      return initModeWrite.promise;
    })
    .mockImplementationOnce((state) => {
      recordUpdate(state);
      return toggleWrite.promise;
    });
  const currentVoice = startVoiceProvider();
  const init = currentVoice.init({}, 1);
  await flush();
  const setMode = voice.setVoiceOnlyMode(true);
  await flush();
  expect(updateCalls).toEqual([{ channelId: 1, voiceOnlyMode: false }]);

  deviceContext.saveDevices((current) => ({
    ...current,
    microphoneId: 'mic-latest',
    noiseGateThresholdDb: -22
  }));
  initModeWrite.resolve();
  await flush();
  expect(updateCalls).toEqual([
    { channelId: 1, voiceOnlyMode: false },
    { channelId: 1, voiceOnlyMode: true }
  ]);
  expect(storedSettings().voiceOnlyMode).toBe(false);

  pendingEnumeration.resolve([
    device('mic-latest', 'audioinput', 'Latest microphone'),
    device('speaker-1', 'audiooutput', 'Speaker'),
    device('camera-1', 'videoinput', 'Camera')
  ]);
  await flush();
  renderDevices();
  expect(storedSettings()).toMatchObject({
    microphoneId: 'mic-latest',
    noiseGateThresholdDb: -22,
    voiceOnlyMode: false
  });

  toggleWrite.resolve();
  await init;
  expect(await setMode).toBe(true);
  expect(storedSettings()).toMatchObject({
    microphoneId: 'mic-latest',
    noiseGateThresholdDb: -22,
    voiceOnlyMode: true
  });
  expect(updateCalls).toEqual([
    { channelId: 1, voiceOnlyMode: false },
    { channelId: 1, voiceOnlyMode: true }
  ]);
});

test('a rejected update for the same ready session leaves persisted settings unchanged', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(7);
  const error = new Error('mode update rejected');
  updateState.mockImplementationOnce(async (state) => {
    updateCalls.push({
      channelId: serverChannelId,
      voiceOnlyMode: state.voiceOnlyMode
    });
    throw error;
  });

  let rejection: unknown;
  try {
    await voice.setVoiceOnlyMode(true);
  } catch (caught) {
    rejection = caught;
  }

  expect(rejection).toBe(error);
  expect(storedSettings().voiceOnlyMode).toBe(false);
  expect(serverModes.get(7)).toBe(false);
  expect(voice.localVideoStream).toBeUndefined();
  expect(voice.localScreenShareStream).toBeUndefined();
  expect(voice.ownVoiceState.webcamEnabled).toBe(false);
  expect(voice.ownVoiceState.sharingScreen).toBe(false);
});

test('unmount settles a waiting mode update while its channel id is still set', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  const initAck = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return initAck.promise;
  });
  const currentVoice = startVoiceProvider();
  const initialization = currentVoice.init({}, 1).catch((error) => error);
  const outcome = { settled: false, saved: false };
  const modeUpdate = currentVoice.setVoiceOnlyMode(true).then(
    (saved) => {
      outcome.settled = true;
      outcome.saved = saved;
    },
    () => {
      outcome.settled = true;
    }
  );
  await flush();
  unmountHarness(voiceHarness);
  await flush();

  expect(outcome.settled).toBe(true);
  expect(outcome.saved).toBe(false);
  expect(storedSettings().voiceOnlyMode).toBe(false);
  initAck.resolve();
  expect(await initialization).toBeInstanceOf(Error);
  await modeUpdate;
  expect(await currentVoice.init({}, 1).catch((error) => error)).toBeInstanceOf(
    Error
  );
  expect(updateCalls).toEqual([{ channelId: 1, voiceOnlyMode: false }]);
});

test('client replacement during init settles its waiting mode update', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  const initAck = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return initAck.promise;
  });
  const currentVoice = startVoiceProvider();
  const initialization = currentVoice.init({}, 1).catch((error) => error);
  const outcome = { settled: false, saved: false };
  const modeUpdate = currentVoice.setVoiceOnlyMode(true).then(
    (saved) => {
      outcome.settled = true;
      outcome.saved = saved;
    },
    () => {
      outcome.settled = true;
    }
  );
  await flush();
  const replacementUpdate = mock(async () => {});
  trpcClient = createTrpcClient(replacementUpdate);
  initAck.resolve();
  expect(await initialization).toBeInstanceOf(Error);
  await flush();

  expect(outcome.settled).toBe(true);
  expect(outcome.saved).toBe(false);
  expect(replacementUpdate).not.toHaveBeenCalled();
  expect(storedSettings().voiceOnlyMode).toBe(false);
  await modeUpdate;
});

test('failed initialization aborts a waiting voice-only update without persisting it', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  channelId = 14;
  serverChannelId = 14;
  const initializationError = new Error('saved mode initialization failed');
  updateState.mockImplementationOnce(async (state) => {
    recordUpdate(state);
    throw initializationError;
  });
  const currentVoice = startVoiceProvider();
  const initialization = currentVoice.init({}, 14).catch((error) => error);
  await flush();
  const modeUpdate = currentVoice
    .setVoiceOnlyMode(true)
    .catch((error) => error);
  await flush();

  expect(updateCalls).toEqual([{ channelId: 14, voiceOnlyMode: false }]);
  expect(await initialization).toBe(initializationError);
  expect(await modeUpdate).toBe(initializationError);
  expect(storedSettings().voiceOnlyMode).toBe(false);
});

test('leaving before a mode acknowledgement prevents local persistence', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(8);
  const updateAck = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return updateAck.promise;
  });
  const pendingMode = voice.setVoiceOnlyMode(true);
  await flush();
  expect(updateCalls.at(-1)).toEqual({ channelId: 8, voiceOnlyMode: true });

  channelId = undefined;
  renderVoice();
  updateAck.resolve();
  expect(await pendingMode).toBe(false);
  expect(storedSettings().voiceOnlyMode).toBe(false);
});

test('replacing the TRPC client during confirmation aborts without persisting', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(15);
  const updateAck = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return updateAck.promise;
  });
  const pendingMode = voice.setVoiceOnlyMode(true).catch((error) => error);
  await flush();
  const replacementUpdate = mock(async () => {});
  trpcClient = createTrpcClient(replacementUpdate);
  updateAck.resolve();

  const error = await pendingMode;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('connection changed');
  expect(replacementUpdate).not.toHaveBeenCalled();
  expect(storedSettings().voiceOnlyMode).toBe(false);
});

test('a replaced session client cannot confirm a voice-only update', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(16);
  const replacementUpdate = mock(async (state: { voiceOnlyMode: boolean }) => {
    recordUpdate(state);
  });
  trpcClient = createTrpcClient(replacementUpdate);

  const result = await voice.setVoiceOnlyMode(true).catch((error) => error);

  expect(result).toBeInstanceOf(Error);
  expect(replacementUpdate).not.toHaveBeenCalled();
  expect(storedSettings().voiceOnlyMode).toBe(false);
});

test('a same-channel rejoin is a new session and receives the pending desired mode', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(9);
  const oldAck = deferred<void>();
  updateState.mockImplementationOnce((state) => {
    recordUpdate(state);
    return oldAck.promise;
  });
  const pendingMode = voice.setVoiceOnlyMode(true);
  await flush();

  channelId = undefined;
  renderVoice();
  channelId = 9;
  serverChannelId = 9;
  renderVoice();
  await voice.init({}, 9);
  renderVoice();
  oldAck.resolve();

  expect(await pendingMode).toBe(true);
  expect(updateCalls).toEqual([
    { channelId: 9, voiceOnlyMode: false },
    { channelId: 9, voiceOnlyMode: true },
    { channelId: 9, voiceOnlyMode: false },
    { channelId: 9, voiceOnlyMode: true }
  ]);
  expect(serverModes.get(9)).toBe(true);
  expect(storedSettings().voiceOnlyMode).toBe(true);
  expect(voice.ownVoiceState.webcamEnabled).toBe(false);
  expect(voice.ownVoiceState.sharingScreen).toBe(false);
});

test('voice-only resync stops after two replacement-session retries without saving', async () => {
  setDevicesSettings({ voiceOnlyMode: false, microphoneId: 'mic-1' });
  renderDevices();
  await initializeSession(10);
  const acknowledgements = [
    deferred<void>(),
    deferred<void>(),
    deferred<void>()
  ];
  let toggleCount = 0;
  updateState.mockImplementation(async (state) => {
    if (!state.voiceOnlyMode) {
      recordUpdate(state);
      return;
    }
    updateCalls.push({ channelId: serverChannelId, voiceOnlyMode: true });
    const ack = acknowledgements[toggleCount++];
    if (!ack) throw new Error('unexpected extra voice-only resync');
    await ack.promise;
  });
  const pendingMode = voice.setVoiceOnlyMode(true).then(
    () => undefined,
    (error) => error
  );
  await flush();

  const replaceSession = async (id: number) => {
    channelId = undefined;
    renderVoice();
    channelId = id;
    serverChannelId = id;
    renderVoice();
    await voice.init({}, id);
    renderVoice();
  };
  await replaceSession(11);
  acknowledgements[0]!.resolve();
  await flush();
  await replaceSession(12);
  acknowledgements[1]!.resolve();
  await flush();
  await replaceSession(13);
  acknowledgements[2]!.resolve();
  const result = await pendingMode;

  expect(result).toBeInstanceOf(Error);
  expect(toggleCount).toBe(3);
  expect(updateCalls.filter((call) => call.voiceOnlyMode)).toHaveLength(3);
  expect(
    updateCalls.some((call) => call.channelId === 13 && call.voiceOnlyMode)
  ).toBe(false);
  expect(storedSettings().voiceOnlyMode).toBe(false);
});
