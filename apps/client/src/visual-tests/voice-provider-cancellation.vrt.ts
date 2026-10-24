import { DevicesProvider } from '@/components/devices-provider';
import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import {
  VoiceProvider,
  VoiceProviderContext,
  type TVoiceProvider
} from '@/components/voice-provider';
import { setCurrentVoiceChannelId } from '@/features/server/channels/actions';
import { LocalStorageKey } from '@/helpers/storage';
import { act, createElement, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

type TUpdateState = (state: { voiceOnlyMode: boolean }) => Promise<void>;
type TSubscription = { subscribe: () => { unsubscribe: () => void } };
type TTestTrpcClient = {
  voice: {
    updateState: { mutate: TUpdateState };
    onNewProducer: TSubscription;
    onProducerClosed: TSubscription;
    onScreenConsumerStarted: TSubscription;
    onLeave: TSubscription;
    onRemoveExternalStream: TSubscription;
    onDirectMediaSignal: TSubscription;
    onRelayDemand: TSubscription;
  };
};
type TInitOutcome =
  { status: 'resolved' } | { status: 'rejected'; error: unknown };

const trpcState = vi.hoisted(() => ({
  client: null as TTestTrpcClient | null,
  translate: (key: string) => key
}));

vi.mock('@/lib/trpc', () => ({
  cleanup: vi.fn(),
  connectToTRPC: vi.fn(),
  getTRPCClient: () => {
    if (!trpcState.client) throw new Error('Test TRPC client is not installed');
    return trpcState.client;
  }
}));
vi.mock('@/helpers/browser-logger', () => ({
  logDebug: vi.fn(),
  logVoice: vi.fn(),
  logVoiceError: vi.fn(),
  logVoiceWarn: vi.fn()
}));
vi.mock('@/helpers/sounds', () => ({ playSound: vi.fn() }));
vi.mock('@/hooks/use-screen-share-support', () => ({
  useScreenShareSupport: () => ({ isScreenShareSupported: false })
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: trpcState.translate })
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

const within = async <T>(promise: Promise<T>, timeoutMs = 500) => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timed-out'>((resolve) => {
        timer = window.setTimeout(() => resolve('timed-out'), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
};

const modeSettlement = (promise: Promise<boolean>) =>
  promise.then(
    (value) => ({ status: 'resolved' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error })
  );

const noOpSubscription = (): TSubscription => ({
  subscribe: () => ({ unsubscribe: () => {} })
});

const makeClient = (mutate: TUpdateState) => {
  const updateState = vi.fn(mutate);
  const client = {
    voice: {
      updateState: { mutate: updateState },
      onNewProducer: noOpSubscription(),
      onProducerClosed: noOpSubscription(),
      onScreenConsumerStarted: noOpSubscription(),
      onLeave: noOpSubscription(),
      onRemoveExternalStream: noOpSubscription(),
      onDirectMediaSignal: noOpSubscription(),
      onRelayDemand: noOpSubscription()
    }
  } as TTestTrpcClient;
  return { client, updateState };
};

let root: Root | undefined;
let voice: TVoiceProvider | undefined;
let deviceLoading: boolean | undefined;
let storageWrites: [string, string][];
let mediaDevices: Pick<
  MediaDevices,
  | 'enumerateDevices'
  | 'getUserMedia'
  | 'addEventListener'
  | 'removeEventListener'
>;
let setCurrentVoiceChannel: (channelId: number | undefined) => void;
const originalMediaDevices = navigator.mediaDevices;

const VoiceProbe = () => {
  voice = useContext(VoiceProviderContext);
  deviceLoading = useDevices().loading;
  return null;
};

const mountProviders = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(
      createElement(DevicesProvider, {
        children: createElement(VoiceProvider, {
          children: createElement(VoiceProbe)
        })
      })
    );
    await flushMicrotasks();
  });

  if (!voice) throw new Error('VoiceProvider did not publish its context');
  if (deviceLoading !== false)
    throw new Error('DevicesProvider did not settle');
  return voice;
};

const startInit = async (currentVoice: TVoiceProvider) => {
  let init!: Promise<void>;
  await act(async () => {
    init = currentVoice.init({}, 1);
    await flushMicrotasks();
  });
  return { init };
};

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  localStorage.setItem(
    LocalStorageKey.DEVICES_SETTINGS,
    JSON.stringify({
      voiceOnlyMode: false,
      microphoneId: 'default',
      playbackId: 'default',
      webcamId: 'default'
    })
  );
  setCurrentVoiceChannel = setCurrentVoiceChannelId;
  setCurrentVoiceChannel(1);
  voice = undefined;
  deviceLoading = undefined;
  root = undefined;
  storageWrites = [];
  mediaDevices = {
    enumerateDevices: vi.fn(async () => []),
    getUserMedia: vi.fn(async () => {
      throw new Error('Microphone acquisition is outside this test');
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices
  });
  trpcState.client = null;
});

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = undefined;
  }
  setCurrentVoiceChannel(undefined);
  trpcState.client = null;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalMediaDevices
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

const trackDevicePreferenceWrites = () => {
  const originalSetItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string
  ) {
    storageWrites.push([key, value]);
    originalSetItem.call(this, key, value);
  });
};

const devicePreferenceWrites = () =>
  storageWrites.filter(([key]) => key === LocalStorageKey.DEVICES_SETTINGS);

test('unmounting VoiceProvider settles a pending voice-only toggle without saving device preferences', async () => {
  const initialRpc = deferred<void>();
  const clientA = makeClient(() => initialRpc.promise);
  trpcState.client = clientA.client;
  const currentVoice = await mountProviders();
  trackDevicePreferenceWrites();

  const { init } = await startInit(currentVoice);
  expect(clientA.updateState).toHaveBeenCalledExactlyOnceWith({
    voiceOnlyMode: false
  });

  let settled!: Promise<
    | { status: 'resolved'; value: boolean }
    | { status: 'rejected'; error: unknown }
  >;
  await act(async () => {
    settled = modeSettlement(currentVoice.setVoiceOnlyMode(true));
    await flushMicrotasks();
  });

  await act(async () => root!.unmount());
  root = undefined;
  const toggleOutcome = await within(settled);

  await act(async () => {
    initialRpc.resolve();
    await init.catch(() => undefined);
  });

  expect(toggleOutcome).not.toBe('timed-out');
  expect(devicePreferenceWrites()).toEqual([]);
  expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(clientA.updateState).toHaveBeenCalledExactlyOnceWith({
    voiceOnlyMode: false
  });
});

test('replacing the client during init settles the waiting toggle without retrying or saving preferences', async () => {
  const initialRpc = deferred<void>();
  const clientA = makeClient(() => initialRpc.promise);
  const clientB = makeClient(async () => {});
  trpcState.client = clientA.client;
  const currentVoice = await mountProviders();
  trackDevicePreferenceWrites();

  const { init } = await startInit(currentVoice);
  expect(clientA.updateState).toHaveBeenCalledExactlyOnceWith({
    voiceOnlyMode: false
  });

  let settled!: Promise<
    | { status: 'resolved'; value: boolean }
    | { status: 'rejected'; error: unknown }
  >;
  await act(async () => {
    settled = modeSettlement(currentVoice.setVoiceOnlyMode(true));
    await flushMicrotasks();
  });

  trpcState.client = clientB.client;
  let initOutcome!: TInitOutcome;
  await act(async () => {
    initialRpc.resolve();
    initOutcome = await init.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    );
  });
  const toggleOutcome = await within(settled);
  const writesAfterReplacement = devicePreferenceWrites();

  expect(initOutcome.status).toBe('rejected');
  expect(toggleOutcome).not.toBe('timed-out');
  expect(clientB.updateState).not.toHaveBeenCalled();
  expect(writesAfterReplacement).toEqual([]);
  expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
