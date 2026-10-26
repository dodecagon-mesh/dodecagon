import { Dialog } from '@/components/dialogs/dialogs';
import { VoiceControl } from '@/components/left-sidebar/voice-control';
import '@fontsource-variable/inter';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../index.css';

const state = vi.hoisted(() => ({
  voiceChannelId: 42 as number | undefined,
  voiceServerModes: {} as Record<number, boolean>,
  storeListeners: [] as (() => void)[],
  events: [] as string[],
  canUseWebcam: true,
  canShareScreen: true,
  devices: {
    microphoneId: 'mic-1',
    playbackId: 'speaker-1',
    webcamId: 'camera-1',
    voiceOnlyMode: false
  },
  saveDevices: vi.fn(
    (
      _devices:
        | {
            microphoneId: string;
            playbackId: string;
            webcamId: string;
            voiceOnlyMode: boolean;
          }
        | ((current: {
            microphoneId: string;
            playbackId: string;
            webcamId: string;
            voiceOnlyMode: boolean;
          }) => {
            microphoneId: string;
            playbackId: string;
            webcamId: string;
            voiceOnlyMode: boolean;
          })
    ) => {}
  ),
  updateVoiceState: vi.fn(async (_state: { voiceOnlyMode: boolean }) => {}),
  setVoiceOnlyMode: vi.fn(async (_voiceOnlyMode: boolean) => false),
  openOverlay: vi.fn(),
  toastError: vi.fn(),
  toggleWebcam: vi.fn(),
  toggleScreenShare: vi.fn()
}));

vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({
    devices: state.devices,
    saveDevices: state.saveDevices
  })
}));
vi.mock('@/features/server/channels/hooks', () => ({
  useChannelById: () => ({ name: 'Voice room' }),
  useCurrentVoiceChannelId: () => state.voiceChannelId,
  useChannelPermissionsById: () => ({})
}));
vi.mock('@/features/server/hooks', () => ({
  useCurrentVoicePeers: () => [],
  useChannelCan: () => (permission: string) =>
    permission === 'WEBCAM' ? state.canUseWebcam : state.canShareScreen,
  useServerName: () => 'Test server',
  useCan: () => () => true,
  useHiddenPluginComponents: () => [],
  usePublicServerSettings: () => undefined,
  useUserRoles: () => []
}));
vi.mock('@/features/store', () => ({
  store: {
    getState: () => ({
      server: { currentVoiceChannelId: state.voiceChannelId }
    }),
    subscribe: (listener: () => void) => {
      state.storeListeners.push(listener);
      return () => {
        state.storeListeners = state.storeListeners.filter(
          (current) => current !== listener
        );
      };
    }
  },
  useStoreSelector: (selector: (state: unknown) => unknown) =>
    selector({
      server: { currentVoiceChannelId: state.voiceChannelId }
    })
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useVoice: () => ({
    ownVoiceState: { webcamEnabled: false, sharingScreen: false },
    toggleWebcam: state.toggleWebcam,
    toggleScreenShare: state.toggleScreenShare,
    setVoiceOnlyMode: state.setVoiceOnlyMode,
    connectionStatus: 'connected',
    isScreenShareSupported: true
  })
}));
vi.mock('@/features/server/voice/actions', () => ({ leaveVoice: vi.fn() }));
vi.mock('@/features/overlays/actions', () => ({
  openOverlay: state.openOverlay
}));
vi.mock('@/lib/trpc', () => ({
  cleanup: vi.fn(),
  connectToTRPC: vi.fn(),
  getTRPCClient: () => ({
    voice: { updateState: { mutate: state.updateVoiceState } }
  })
}));
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: { ...actual.toast, error: state.toastError }
  };
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        voiceConnecting: 'Voice connecting',
        voiceConnected: 'Voice connected',
        voiceFailed: 'Voice failed',
        voiceDisconnected: 'Voice disconnected',
        disconnectVoice: 'Disconnect voice',
        voiceDiagnostics: 'Voice diagnostics',
        transportStats: 'Transport stats',
        'settings:voiceOnlyModeLabel': 'Voice-only mode',
        'settings:voiceOnlyModeDesc':
          'Send and receive microphone audio only; cameras, screen sharing, and external media are disabled.',
        'settings:failedSaveDeviceSettings': 'Could not save device settings',
        turnOffCamera: 'Turn off camera',
        turnOnCamera: 'Turn on camera',
        stopScreenShare: 'Stop screen share',
        startScreenShare: 'Start screen share'
      })[key] ?? key
  })
}));
vi.mock('@/components/channel-view/voice/voice-audio-streams', () => ({
  VoiceAudioStreams: () => null
}));
vi.mock('@/components/channel-view/voice/external-audio-streams', () => ({
  ExternalAudioStreams: () => null
}));
vi.mock('@/components/plugin-slot-renderer', () => ({
  PluginSlotRenderer: () => null
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let remountVersion = 0;
const originalDevices = {
  microphoneId: 'mic-1',
  playbackId: 'speaker-1',
  webcamId: 'camera-1',
  voiceOnlyMode: false
};

const confirmMockVoiceOnlyMode = async (voiceOnlyMode: boolean) => {
  await state.updateVoiceState({ voiceOnlyMode });
  state.saveDevices((current) => ({ ...current, voiceOnlyMode }));
  return true;
};

const render = async (remount = false) => {
  document.documentElement.classList.add('dark');
  if (!root) {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:252px;height:76px';
    document.body.append(host);
    root = createRoot(host);
  }
  root.render(
    remount
      ? createElement(VoiceControl, { key: ++remountVersion })
      : createElement(VoiceControl)
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
};

afterEach(() => {
  root?.unmount();
  root = undefined;
  host = undefined;
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark');
  state.devices = { ...originalDevices };
  state.voiceChannelId = 42;
  remountVersion = 0;
  state.voiceServerModes = {};
  state.storeListeners = [];
  state.events = [];
  state.canUseWebcam = true;
  state.canShareScreen = true;
  state.saveDevices.mockReset();
  state.saveDevices.mockImplementation((devices) => {
    state.devices =
      typeof devices === 'function' ? devices(state.devices) : devices;
    state.events.push(`save:${state.devices.voiceOnlyMode}`);
  });
  state.updateVoiceState.mockReset();
  state.updateVoiceState.mockImplementation(async (nextState) => {
    const channelId = state.voiceChannelId;
    if (channelId === undefined) return;
    state.voiceServerModes[channelId] = nextState.voiceOnlyMode;
    state.events.push(`server:${channelId}:${nextState.voiceOnlyMode}`);
  });
  state.setVoiceOnlyMode.mockReset();
  state.setVoiceOnlyMode.mockImplementation(confirmMockVoiceOnlyMode);
  state.openOverlay.mockReset();
  state.toastError.mockReset();
  state.toggleWebcam.mockReset();
  state.toggleScreenShare.mockReset();
});

state.saveDevices.mockImplementation((devices) => {
  state.devices =
    typeof devices === 'function' ? devices(state.devices) : devices;
  state.events.push(`save:${state.devices.voiceOnlyMode}`);
});
state.updateVoiceState.mockImplementation(async (nextState) => {
  const channelId = state.voiceChannelId;
  if (channelId === undefined) return;
  state.voiceServerModes[channelId] = nextState.voiceOnlyMode;
  state.events.push(`server:${channelId}:${nextState.voiceOnlyMode}`);
});
state.setVoiceOnlyMode.mockImplementation(confirmMockVoiceOnlyMode);

test('eye toggles the existing mode after the server accepts and preserves device settings', async () => {
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'false');

  await modeButton.click();
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));
  await render();

  expect(state.updateVoiceState).toHaveBeenCalledWith({ voiceOnlyMode: true });
  expect(state.saveDevices).toHaveBeenCalledTimes(1);
  expect(state.saveDevices.mock.calls[0][0]).toEqual(expect.any(Function));
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');
  await expect
    .element(modeButton)
    .toHaveAttribute(
      'title',
      'Send and receive microphone audio only; cameras, screen sharing, and external media are disabled.'
    );
  const activeColor = 'rgb(255, 255, 255)';
  await vi.waitFor(() =>
    expect(getComputedStyle(modeButton.element()).color).toBe(activeColor)
  );
  await userEvent.unhover(page.elementLocator(document.body));
  await expect
    .poll(() => getComputedStyle(modeButton.element()).backgroundColor)
    .toBe('rgb(36, 128, 70)');
  await expect
    .element(page.getByRole('button', { name: 'Turn on camera' }))
    .toBeDisabled();
  await expect
    .element(page.getByRole('button', { name: 'Start screen share' }))
    .toBeDisabled();
  expect(state.toggleWebcam).not.toHaveBeenCalled();
  expect(state.toggleScreenShare).not.toHaveBeenCalled();
  await document.fonts.ready;
  await userEvent.unhover(page.elementLocator(document.body));
  await expect(page.elementLocator(document.documentElement)).toMatchScreenshot(
    'voice-control-dock-audio-only'
  );
});

test('eye activation follows native Enter and Space keyboard button behavior', async () => {
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.element().focus();
  await userEvent.keyboard('{Enter}');
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));
  await render();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');

  await modeButton.element().focus();
  await userEvent.keyboard('{Space}');
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(2));
  await render();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'false');
  expect(state.updateVoiceState).toHaveBeenNthCalledWith(1, {
    voiceOnlyMode: true
  });
  expect(state.updateVoiceState).toHaveBeenNthCalledWith(2, {
    voiceOnlyMode: false
  });
  expect(state.toggleWebcam).not.toHaveBeenCalled();
  expect(state.toggleScreenShare).not.toHaveBeenCalled();
});

test('pending server update disables repeated toggles and delays local persistence', async () => {
  let resolveUpdate!: () => void;
  state.updateVoiceState.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.updateVoiceState).toHaveBeenCalledTimes(1)
  );
  await expect.element(modeButton).toBeDisabled();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'false');
  (modeButton.element() as HTMLButtonElement).click();
  expect(state.updateVoiceState).toHaveBeenCalledTimes(1);
  expect(state.saveDevices).not.toHaveBeenCalled();
  resolveUpdate();
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));
  await render();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');
});

test('voice-only persistence keeps device preferences changed while the server update is pending', async () => {
  let resolveUpdate!: () => void;
  state.updateVoiceState.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.updateVoiceState).toHaveBeenCalledTimes(1)
  );
  state.devices = {
    ...state.devices,
    microphoneId: 'mic-2',
    playbackId: 'speaker-2'
  };
  resolveUpdate();
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));

  expect(state.devices).toEqual({
    ...originalDevices,
    microphoneId: 'mic-2',
    playbackId: 'speaker-2',
    voiceOnlyMode: true
  });
});

test('dock waits for provider confirmation before completing the mode action', async () => {
  let confirmMode!: () => void;
  state.setVoiceOnlyMode.mockImplementationOnce(
    (voiceOnlyMode) =>
      new Promise<boolean>((resolve) => {
        confirmMode = () => {
          state.saveDevices((current) => ({ ...current, voiceOnlyMode }));
          resolve(true);
        };
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.setVoiceOnlyMode).toHaveBeenCalledWith(true)
  );
  await expect.element(modeButton).toBeDisabled();
  expect(state.saveDevices).not.toHaveBeenCalled();
  confirmMode();
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));
  await render();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');
});

test('an unconfirmed replacement-session result does not save a requested mode', async () => {
  state.setVoiceOnlyMode.mockResolvedValueOnce(false);
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.setVoiceOnlyMode).toHaveBeenCalledWith(true)
  );
  await expect.element(modeButton).toBeEnabled();

  expect(state.saveDevices).not.toHaveBeenCalled();
  expect(state.devices.voiceOnlyMode).toBe(false);
  expect(state.toastError).not.toHaveBeenCalled();
});

test('same-channel rejoin confirmation is delegated to the provider action', async () => {
  let confirmMode!: () => void;
  state.setVoiceOnlyMode.mockImplementationOnce(
    (voiceOnlyMode) =>
      new Promise<boolean>((resolve) => {
        confirmMode = () => {
          state.saveDevices((current) => ({ ...current, voiceOnlyMode }));
          resolve(true);
        };
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.setVoiceOnlyMode).toHaveBeenCalledTimes(1)
  );
  state.voiceChannelId = undefined;
  await render();
  state.voiceChannelId = 42;
  await render();
  expect(state.saveDevices).not.toHaveBeenCalled();

  confirmMode();
  await vi.waitFor(() => expect(state.saveDevices).toHaveBeenCalledTimes(1));
  expect(state.setVoiceOnlyMode).toHaveBeenCalledWith(true);
  expect(state.devices.voiceOnlyMode).toBe(true);
});

test('leaving voice while provider confirmation is pending does not save a mode', async () => {
  let confirmLeaving!: () => void;
  state.setVoiceOnlyMode.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        confirmLeaving = () => resolve(false);
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.setVoiceOnlyMode).toHaveBeenCalledTimes(1)
  );
  state.voiceChannelId = undefined;
  await render();
  confirmLeaving();
  const pendingResult = state.setVoiceOnlyMode.mock.results[0]
    ?.value as Promise<boolean>;
  expect(await pendingResult).toBe(false);

  expect(state.saveDevices).not.toHaveBeenCalled();
  expect(state.devices.voiceOnlyMode).toBe(false);
});

test('a rejected update leaves local mode unchanged and reports the error', async () => {
  state.devices = { ...originalDevices, voiceOnlyMode: true };
  let rejectUpdate!: (error: Error) => void;
  state.updateVoiceState.mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        rejectUpdate = reject;
      })
  );
  await render();
  const modeButton = page.getByRole('button', {
    name: 'Voice-only mode',
    exact: true
  });
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');

  await modeButton.click();
  await vi.waitFor(() =>
    expect(state.updateVoiceState).toHaveBeenCalledTimes(1)
  );
  state.devices = { ...state.devices, microphoneId: 'mic-2' };
  rejectUpdate(new Error('offline'));
  await vi.waitFor(() => expect(state.toastError).toHaveBeenCalledTimes(1));
  await render();

  expect(state.updateVoiceState).toHaveBeenCalledWith({ voiceOnlyMode: false });
  expect(state.devices).toEqual({
    ...originalDevices,
    microphoneId: 'mic-2',
    voiceOnlyMode: true
  });
  expect(state.saveDevices).not.toHaveBeenCalled();
  await expect.element(modeButton).toHaveAttribute('aria-pressed', 'true');
  await expect.element(modeButton).toBeEnabled();
});

test('Wi-Fi connection badge opens transport stats by click and keyboard', async () => {
  await render();
  const diagnosticsTrigger = page.getByRole('button', {
    name: 'Transport stats',
    exact: true
  });

  await diagnosticsTrigger.click();
  await expect
    .element(page.getByRole('heading', { name: 'Transport stats' }))
    .toBeInTheDocument();
  expect(state.openOverlay).not.toHaveBeenCalled();

  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(diagnosticsTrigger.element())
  );
  await userEvent.keyboard('{Enter}');
  await expect
    .element(page.getByRole('heading', { name: 'Transport stats' }))
    .toBeInTheDocument();
  expect(state.openOverlay).not.toHaveBeenCalled();
});

test('advanced diagnostics closes transport stats before opening the dialog', async () => {
  await render();
  const diagnosticsTrigger = page.getByRole('button', {
    name: 'Transport stats',
    exact: true
  });
  await diagnosticsTrigger.click();
  await expect
    .element(page.getByRole('heading', { name: 'Transport stats' }))
    .toBeInTheDocument();

  await page
    .getByRole('button', { name: 'Voice diagnostics', exact: true })
    .click();

  expect(state.openOverlay).toHaveBeenCalledTimes(1);
  expect(state.openOverlay).toHaveBeenCalledWith({
    kind: 'dialog',
    name: Dialog.VOICE_DEBUG
  });
  await expect
    .element(page.getByRole('heading', { name: 'Transport stats' }))
    .not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(diagnosticsTrigger.element())
  );
});

test('voice-only controls preserve separate camera and screen-share permission gates', async () => {
  state.canUseWebcam = false;
  await render();

  await expect
    .element(page.getByRole('button', { name: 'Turn on camera' }))
    .toBeDisabled();
  await expect
    .element(page.getByRole('button', { name: 'Start screen share' }))
    .toBeEnabled();

  state.canUseWebcam = true;
  state.canShareScreen = false;
  await render(true);

  await expect
    .element(page.getByRole('button', { name: 'Turn on camera' }))
    .toBeEnabled();
  await expect
    .element(page.getByRole('button', { name: 'Start screen share' }))
    .toBeDisabled();
});

test('voice dock uses the compact connection summary controls', async () => {
  await render();
  const wifi = page
    .getByRole('button', { name: 'Transport stats', exact: true })
    .element();
  const disconnect = page
    .getByRole('button', { name: 'Disconnect voice', exact: true })
    .element();
  expect(wifi.getBoundingClientRect().width).toBe(24);
  expect(wifi.getBoundingClientRect().height).toBe(24);
  expect(getComputedStyle(wifi).padding).toBe('0px');
  expect(wifi.querySelector('svg')!.getBoundingClientRect().height).toBe(16);
  // the disconnect control is square in the dock, like the microphone one
  expect(disconnect.getBoundingClientRect().width).toBe(28);
  expect(disconnect.getBoundingClientRect().height).toBe(28);
  expect(getComputedStyle(disconnect).padding).toBe('0px');
  expect(disconnect.querySelector('svg')!.getBoundingClientRect().height).toBe(
    18
  );
  for (const [name, iconSize] of [
    ['Turn on camera', 18],
    ['Start screen share', 20],
    ['Voice-only mode', 20]
  ] as const) {
    const button = page.getByRole('button', { name, exact: true }).element();
    const icon = button.querySelector('svg')!;
    expect(button.getBoundingClientRect().height).toBe(24);
    expect(getComputedStyle(button).paddingTop).toBe('0px');
    expect(icon.getBoundingClientRect().height).toBe(iconSize);
  }
});

test('dock content is the 44px summary plus 32px action row', async () => {
  await render();

  const dock = host?.firstElementChild as HTMLDivElement;
  const [topRow, bottomRow] = Array.from(dock.children) as HTMLDivElement[];
  expect(dock.getBoundingClientRect().height).toBe(76);
  expect(topRow.getBoundingClientRect().height).toBe(44);
  expect(bottomRow.getBoundingClientRect().height).toBe(32);
  expect(topRow.children).toHaveLength(3);
  // one icon per button, so an extra activity glyph in the dock would push it over
  expect(dock.querySelectorAll('svg')).toHaveLength(5);
  expect(dock.querySelectorAll('button')).toHaveLength(5);

  await document.fonts.ready;
  await userEvent.unhover(page.elementLocator(document.body));
  await expect(page.elementLocator(document.documentElement)).toMatchScreenshot(
    'voice-control-dock'
  );
});
