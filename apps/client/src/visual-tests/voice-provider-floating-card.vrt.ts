import { VoiceCardContextMenu } from '@/components/channel-view/voice/voice-card-context-menu';
import { VoiceProvider } from '@/components/voice-provider';
import { VolumeControlProvider } from '@/components/voice-provider/volume-control-context';
import '@fontsource-variable/inter';
import { createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';

const state = vi.hoisted(() => {
  const noop = () => {};
  const asyncNoop = async () => {};

  return {
    currentVoiceChannelId: 42 as number | undefined,
    isCurrentVoiceChannelSelected: true,
    pinnedCard: { id: 'remote-user-2', type: 'user', userId: 2 },
    devices: {
      voiceOnlyMode: false,
      directScreenSharing: false,
      noiseSuppression: 'disabled',
      noiseGateEnabled: false,
      noiseGateThresholdDb: -45
    },
    ownVoiceState: {
      micMuted: false,
      soundMuted: false,
      voiceOnlyMode: false,
      webcamEnabled: false,
      sharingScreen: false
    },
    localStreams: {
      localAudioProducer: { current: null },
      localVideoProducer: { current: null },
      localScreenShareProducer: { current: null },
      localScreenShareAudioProducer: { current: null },
      localAudioStream: undefined,
      localVideoStream: undefined,
      localScreenShareStream: undefined,
      localScreenShareAudioStream: undefined,
      setLocalAudioStream: noop,
      setLocalVideoStream: noop,
      setLocalScreenShare: noop,
      setLocalScreenShareAudio: noop,
      clearLocalStreams: noop
    },
    remoteStreams: {
      externalStreams: {},
      remoteUserStreams: {},
      addExternalStreamTrack: noop,
      removeExternalStreamTrack: noop,
      removeExternalStream: noop,
      clearExternalStreams: noop,
      addRemoteUserStream: noop,
      removeRemoteUserStream: noop,
      clearRemoteUserStreamsForUser: noop,
      clearRemoteUserStreams: noop
    },
    transportState: {
      producerTransport: { current: null },
      consumerTransport: { current: null },
      sessionGenerationRef: { current: 0 },
      consumers: { current: {} },
      consumerStreams: { current: new Map() },
      consumeOperationsInProgress: { current: new Map() },
      consumeRef: { current: null },
      createProducerTransport: asyncNoop,
      createConsumerTransport: asyncNoop,
      consumeExistingProducers: asyncNoop,
      cleanupTransports: noop,
      getConsumer: () => undefined,
      getConsumerCodec: () => undefined,
      pauseDemoConsumers: asyncNoop,
      closeConsumer: noop,
      closeConsumers: noop
    },
    directScreenShare: {
      getConnections: () => [],
      acceptPendingOffer: () => false,
      stopReceiving: noop,
      close: noop,
      start: asyncNoop,
      stop: noop,
      acceptPendingOfferIfReady: noop
    },
    transportStats: {
      stats: {
        producer: null,
        consumer: null,
        screenShare: null,
        totalBytesReceived: 0,
        totalBytesSent: 0,
        currentBitrateSent: 0,
        currentBitrateReceived: 0
      },
      subscribe: () => noop,
      startMonitoring: noop,
      stopMonitoring: noop,
      resetStats: noop,
      setScreenShareProducer: noop
    },
    voiceControls: {
      toggleMic: asyncNoop,
      toggleSound: asyncNoop,
      toggleWebcam: asyncNoop,
      toggleScreenShare: asyncNoop
    }
  };
});

vi.mock('@/features/server/channels/hooks', () => ({
  useCurrentVoiceChannelId: () => state.currentVoiceChannelId,
  useIsCurrentVoiceChannelSelected: () => state.isCurrentVoiceChannelSelected
}));
vi.mock('@/features/server/hooks', () => ({
  useWebRtcSimulcastEnabled: () => false,
  useCurrentVoicePeers: () => []
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useOwnVoiceState: () => state.ownVoiceState,
  usePinnedCard: () => state.pinnedCard
}));
vi.mock('@/features/server/voice/actions', () => ({
  setPinnedCard: vi.fn(),
  updateOwnVoiceState: vi.fn()
}));
vi.mock('@/features/server/channels/actions', () => ({
  setSelectedChannelId: vi.fn()
}));
vi.mock('@/features/server/users/hooks', () => ({
  useOwnUserId: () => 1,
  useUserById: (userId: number) =>
    userId === 2 ? { id: 2, name: 'Remote user' } : undefined
}));
vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({ devices: state.devices, saveDevices: vi.fn() })
}));
vi.mock('@/components/user-avatar', () => ({ UserAvatar: () => null }));
vi.mock('@/components/voice-provider/demo-visibility-context', () => ({
  DemoVisibilityProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useDemoVisibility: () => ({ viewedRemoteDemos: {} })
}));
vi.mock('@/components/voice-provider/remote-webcam-visibility-context', () => ({
  RemoteWebcamVisibilityProvider: ({
    children
  }: {
    children: React.ReactNode;
  }) => children,
  useRemoteWebcamVisibility: () => ({ isWebcamHidden: () => false })
}));
vi.mock('@/components/voice-provider/hooks/use-local-streams', () => ({
  useLocalStreams: () => state.localStreams
}));
vi.mock('@/components/voice-provider/hooks/use-remote-streams', () => ({
  useRemoteStreams: () => state.remoteStreams
}));
vi.mock('@/components/voice-provider/hooks/use-transports', () => ({
  useTransports: () => state.transportState
}));
vi.mock('@/components/voice-provider/hooks/use-transport-stats', () => ({
  useTransportStats: () => state.transportStats
}));
vi.mock('@/components/voice-provider/hooks/use-direct-media', () => ({
  useDirectMedia: () => ({
    directMedia: {
      audio: state.directScreenShare,
      video: state.directScreenShare,
      screen: state.directScreenShare
    }
  })
}));
vi.mock('@/components/voice-provider/hooks/use-voice-controls', () => ({
  useVoiceControls: () => state.voiceControls
}));
vi.mock('@/hooks/use-screen-share-support', () => ({
  useScreenShareSupport: () => ({ isScreenShareSupported: false })
}));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  };
});
vi.mock('@/helpers/browser-logger', () => ({
  logDebug: vi.fn(),
  logVoice: vi.fn(),
  logVoiceWarn: vi.fn(),
  logVoiceError: vi.fn()
}));
vi.mock('@/helpers/voice-debug', () => ({
  clearVoiceDebugEvents: vi.fn(),
  collectVoiceDebugSnapshot: vi.fn(async () => ({})),
  getVoiceDebugEvents: () => [],
  pushVoiceDebugEvent: vi.fn(),
  registerVoiceDebugSource: () => () => {}
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let pictureInPictureEnabledDescriptor: PropertyDescriptor | undefined;
let requestPictureInPictureDescriptor: PropertyDescriptor | undefined;

const ManualPiPHarness = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const card = createElement(
    'div',
    { 'data-testid': 'video-card' },
    createElement('video', { ref: videoRef })
  );

  return createElement(VoiceCardContextMenu, {
    pictureInPicture: { videoRef },
    children: card
  });
};

const renderProvider = async () => {
  if (!root) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }

  root.render(
    createElement(
      VoiceProvider,
      null,
      createElement(
        'main',
        { 'data-testid': 'text-channel-content' },
        'Text room'
      )
    )
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};

afterEach(async () => {
  root?.unmount();
  root = undefined;
  host = undefined;
  document.body.replaceChildren();
  if (pictureInPictureEnabledDescriptor) {
    Object.defineProperty(
      document,
      'pictureInPictureEnabled',
      pictureInPictureEnabledDescriptor
    );
  } else {
    Reflect.deleteProperty(document, 'pictureInPictureEnabled');
  }
  if (requestPictureInPictureDescriptor) {
    Object.defineProperty(
      HTMLVideoElement.prototype,
      'requestPictureInPicture',
      requestPictureInPictureDescriptor
    );
  } else {
    Reflect.deleteProperty(
      HTMLVideoElement.prototype,
      'requestPictureInPicture'
    );
  }
  pictureInPictureEnabledDescriptor = undefined;
  requestPictureInPictureDescriptor = undefined;
  state.currentVoiceChannelId = 42;
  state.isCurrentVoiceChannelSelected = true;
});

test('selecting a text channel does not float the pinned webcam above the voice provider', async () => {
  await renderProvider();
  await expect
    .element(page.getByTestId('text-channel-content'))
    .toBeInTheDocument();
  expect(document.querySelector('.cursor-move')).toBeNull();

  state.isCurrentVoiceChannelSelected = false;
  state.remoteStreams = {
    ...state.remoteStreams,
    remoteUserStreams: {}
  };
  await renderProvider();

  await expect
    .element(page.getByTestId('text-channel-content'))
    .toBeInTheDocument();
  expect(document.querySelector('.cursor-move')).toBeNull();
});

test('native picture-in-picture stays an explicit video-card context-menu action', async () => {
  pictureInPictureEnabledDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'pictureInPictureEnabled'
  );
  requestPictureInPictureDescriptor = Object.getOwnPropertyDescriptor(
    HTMLVideoElement.prototype,
    'requestPictureInPicture'
  );
  const requestPictureInPicture = vi.fn(
    async () => ({}) as PictureInPictureWindow
  );
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    value: true
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
    configurable: true,
    value: requestPictureInPicture
  });

  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(VolumeControlProvider, null, createElement(ManualPiPHarness))
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );

  const card = document.querySelector<HTMLElement>(
    '[data-testid="video-card"]'
  );
  expect(card).not.toBeNull();
  expect(requestPictureInPicture).not.toHaveBeenCalled();

  card!.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10
    })
  );
  const pipItem = await vi.waitFor(() => {
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ].find((el) => el.textContent?.trim() === 'pictureInPicture');
    expect(item).toBeTruthy();
    return item!;
  });

  await page.elementLocator(pipItem).click();
  await vi.waitFor(() =>
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1)
  );
});
