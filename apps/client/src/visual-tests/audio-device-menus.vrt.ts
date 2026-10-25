import { ControlsBar } from '@/components/channel-view/voice/controls-bar';
import { UserControl } from '@/components/left-sidebar/user-control';
import { TestId } from '@dodecagon/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../index.css';

const { state, toggleMic, toggleSound, saveDevices, openServerScreen } =
  vi.hoisted(() => ({
    state: { canSpeak: true, soundMuted: false },
    toggleMic: vi.fn(),
    toggleSound: vi.fn(),
    saveDevices: vi.fn(),
    openServerScreen: vi.fn()
  }));
vi.mock('@/features/server-screens/actions', () => ({ openServerScreen }));
vi.mock('@/features/server/channels/hooks', () => ({
  useCurrentVoiceChannelId: () => 1,
  useIsCurrentVoiceChannelSelected: () => true
}));
vi.mock('@/features/server/hooks', () => ({
  useChannelCan: () => () => state.canSpeak,
  useCurrentVoicePeers: () => []
}));
vi.mock('@/features/server/users/hooks', () => ({
  useOwnPublicUser: () => ({ id: 1, name: 'Test', status: 'online' })
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useOwnVoiceState: () => ({ micMuted: false, soundMuted: state.soundMuted }),
  useVoice: () => ({
    ownVoiceState: { micMuted: false, soundMuted: state.soundMuted },
    toggleMic,
    toggleSound
  })
}));
vi.mock('@/components/protect', () => ({
  Protect: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock('@/components/channel-view/voice/reactions-button', () => ({
  ReactionsButton: () => null
}));
vi.mock('@/features/server/voice/actions', () => ({ leaveVoice: vi.fn() }));
vi.mock('@/components/user-avatar', () => ({ UserAvatar: () => null }));
vi.mock('@/components/user-popover', () => ({
  UserPopover: ({ children }: { children: React.ReactNode }) => children
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace(/^keybindings:/, '')
  })
}));
vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({
    devices: {
      microphoneId: 'mic',
      playbackId: 'out',
      microphoneVolume: 75,
      playbackVolume: 60
    },
    inputDevices: [
      { deviceId: 'mic', label: 'Studio microphone' },
      { deviceId: 'usb', label: 'USB microphone' }
    ],
    playbackDevices: [{ deviceId: 'out', label: 'Headphones' }],
    saveDevices
  })
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  host?.remove();
  vi.clearAllMocks();
  state.canSpeak = true;
  state.soundMuted = false;
});

test('audio controls open compact device settings on right click without toggling audio', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(UserControl));
  await page
    .getByRole('button', { name: 'muteMic', exact: true })
    .click({ button: 'right' });
  expect(toggleMic).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole('combobox'))
    .toHaveTextContent('inputDeviceStudio microphone');
  const panel = page.getByRole('dialog').element();
  // the popup keeps the width of the voice status block
  expect(panel.getBoundingClientRect().width).toBe(236);
  expect(getComputedStyle(panel).padding).toBe('6px');
  expect(getComputedStyle(panel).borderRadius).toBe('10px');
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'USB microphone' }).click();
  const selectDevice = saveDevices.mock.lastCall![0];
  expect(selectDevice({ microphoneId: 'mic', playbackId: 'out' })).toEqual({
    microphoneId: 'usb',
    playbackId: 'out'
  });
  const slider = page.getByRole('slider');
  await expect.element(slider).toHaveAccessibleName('microphoneVolume');
  await expect.element(slider).toHaveAttribute('aria-valuenow', '75');
  // the base ui slider keeps the focusable range input hidden, the visible
  // thumb carries the pointer
  const thumb = slider
    .element()
    ?.closest<HTMLElement>('[data-slot="slider-thumb"]');

  if (!thumb) {
    throw new Error('the slider thumb is missing');
  }

  await page.elementLocator(thumb).click();
  await userEvent.keyboard('{Home}');
  expect(saveDevices).toHaveBeenCalled();
  const update = saveDevices.mock.lastCall![0];
  expect(update({ microphoneVolume: 75, playbackVolume: 60 })).toEqual({
    microphoneVolume: 0,
    playbackVolume: 60
  });
  await page
    .getByRole('button', { name: 'voiceSettings', exact: true })
    .click();
  expect(openServerScreen).toHaveBeenCalledWith(expect.anything(), {
    initialEntryId: 'devices'
  });
  await page
    .getByRole('button', { name: 'deafen', exact: true })
    .click({ button: 'right' });
  expect(toggleSound).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole('combobox'))
    .toHaveTextContent('outputDeviceHeadphones');
  await expect
    .element(page.getByRole('slider'))
    .toHaveAttribute('aria-valuenow', '60');
  const outputThumb = page
    .getByRole('slider')
    .element()
    ?.closest<HTMLElement>('[data-slot="slider-thumb"]');

  if (!outputThumb) {
    throw new Error('the output slider thumb is missing');
  }

  await page.elementLocator(outputThumb).click();
  await userEvent.keyboard('{End}');
  const outputUpdate = saveDevices.mock.lastCall![0];
  expect(outputUpdate({ microphoneVolume: 75, playbackVolume: 60 })).toEqual({
    microphoneVolume: 75,
    playbackVolume: 100
  });
  await userEvent.keyboard('{Escape}');
  await expect
    .element(page.getByRole('button', { name: 'deafen', exact: true }))
    .toHaveFocus();
  await page.getByRole('button', { name: 'muteMic', exact: true }).click();
  expect(toggleMic).toHaveBeenCalledTimes(1);
  await page.getByRole('button', { name: 'deafen', exact: true }).click();
  expect(toggleSound).toHaveBeenCalledTimes(1);
});

test('main toolbar has no settings arrows and supports keyboard device settings', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(ControlsBar, { channelId: 1, isActive: true }));
  await page
    .getByRole('button', { name: 'Mute', exact: true })
    .click({ button: 'right' });
  expect(toggleMic).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(toggleMic).toHaveBeenCalledTimes(1);
  const deafen = page.getByRole('button', { name: 'Deafen', exact: true });
  deafen.element().focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(toggleSound).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await page.getByRole('button', { name: 'Deafen', exact: true }).click();
  expect(toggleSound).toHaveBeenCalledTimes(1);
  await expect
    .element(
      page.getByRole('button', { name: 'microphoneSettings', exact: true })
    )
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('button', { name: 'outputSettings', exact: true }))
    .not.toBeInTheDocument();
});

test('dismissing audio settings by clicking elsewhere preserves the clicked focus target', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(
      'div',
      null,
      createElement(UserControl),
      createElement('input', { 'aria-label': 'Message' })
    )
  );
  await page
    .getByRole('button', { name: 'muteMic', exact: true })
    .click({ button: 'right' });
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(input).toHaveFocus();
});

test('the device menu opens from the sidebar without leaving the screen', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(
      'div',
      {
        'data-testid': TestId.LEFT_SIDEBAR,
        style: {
          position: 'fixed',
          left: '0px',
          bottom: '0px',
          width: '240px'
        }
      },
      createElement(UserControl)
    )
  );
  await page
    .getByRole('button', { name: 'muteMic', exact: true })
    .click({ button: 'right' });
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const panel = page.getByRole('dialog').element();
  const bounds = panel.getBoundingClientRect();
  const sidebar = document.querySelector(
    `[data-testid="${TestId.LEFT_SIDEBAR}"]`
  )!;
  const sidebarLeft = sidebar.getBoundingClientRect().left;
  expect(bounds.left).toBe(sidebarLeft + 8);
  expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
});

test.each(['toolbar', 'sidebar'] as const)(
  '%s microphone settings stay keyboard reachable without SPEAK permission',
  async (location) => {
    state.canSpeak = false;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    root.render(
      location === 'toolbar'
        ? createElement(ControlsBar, { channelId: 1, isActive: true })
        : createElement(UserControl)
    );
    const mic = page.getByRole('button', {
      name: location === 'toolbar' ? 'Mute' : 'muteMic',
      exact: true
    });
    await expect.element(mic).toBeVisible();
    for (
      let tab = 0;
      tab < 8 && document.activeElement !== mic.element();
      tab++
    ) {
      await userEvent.keyboard('{Tab}');
    }
    await expect.element(mic).toHaveFocus();
    await userEvent.keyboard('{Enter}{Space}');
    expect(toggleMic).not.toHaveBeenCalled();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await expect
      .element(page.getByRole('slider', { name: 'microphoneVolume' }))
      .toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(mic).toHaveFocus();
  }
);
