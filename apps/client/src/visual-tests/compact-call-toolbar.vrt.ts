import { ControlsBar } from '@/components/channel-view/voice/controls-bar';
import { useMouseActivity } from '@/components/channel-view/voice/hooks/use-mouse-activity';
import { VoiceGrid } from '@/components/channel-view/voice/voice-grid';
import { ThemeProvider } from '@/components/theme-provider';
import { ChannelPermission } from '@dodecagon/shared';
import '@fontsource-variable/inter';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../i18n';
import '../index.css';

const state = vi.hoisted(() => ({
  canSpeak: true,
  canReact: true,
  screenShareSupported: true,
  voiceOnlyMode: false,
  micMuted: false,
  webcamEnabled: false,
  sharingScreen: false
}));

vi.mock('@/features/server/channels/hooks', () => ({
  useIsCurrentVoiceChannelSelected: () => true
}));
vi.mock('@/features/server/hooks', () => ({
  useCan: () => () => state.canReact,
  useChannelCan: () => (permission: ChannelPermission) =>
    permission !== ChannelPermission.SPEAK || state.canSpeak
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useOwnVoiceState: () => ({
    micMuted: state.micMuted,
    soundMuted: false,
    webcamEnabled: state.webcamEnabled,
    sharingScreen: state.sharingScreen
  }),
  useVoice: () => ({
    toggleMic: () => {},
    toggleSound: () => {},
    toggleWebcam: () => {},
    toggleScreenShare: () => {},
    isScreenShareSupported: state.screenShareSupported
  })
}));
vi.mock('@/features/server/voice/actions', () => ({ leaveVoice: () => {} }));
vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({
    devices: {
      voiceOnlyMode: state.voiceOnlyMode,
      microphoneId: 'microphone',
      playbackId: 'headphones',
      microphoneVolume: 75,
      playbackVolume: 60
    },
    inputDevices: [{ deviceId: 'microphone', label: 'Studio microphone' }],
    playbackDevices: [{ deviceId: 'headphones', label: 'Headphones' }],
    saveDevices: () => {}
  })
}));

const cards = ['share', 'participant'].map((id) =>
  createElement('div', {
    key: id,
    'data-card': id,
    className: 'size-full rounded-lg bg-nav'
  })
);

const ToolbarStage = () => {
  const { isVisible, stageRef } = useMouseActivity();

  return createElement(
    'div',
    { ref: stageRef, className: 'flex size-full flex-col overflow-hidden' },
    createElement(VoiceGrid, { pinnedCardId: 'share', children: cards }),
    createElement(ControlsBar, { channelId: 1, isActive: isVisible })
  );
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const render = async (width = 1188, theme = 'dark') => {
  await page.viewport(width === 375 ? 375 : 1440, 900);
  localStorage.removeItem('vite-ui-theme');
  host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:900px;background:var(--rail)`;
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(ThemeProvider, {
      defaultTheme: theme,
      children: createElement(ToolbarStage)
    })
  );
  await expect
    .element(page.getByRole('button', { name: /^(Mute|Unmute)$/ }))
    .toBeInTheDocument();
  await document.fonts.ready;
};

const elements = () => {
  const toolbar = host!.querySelector<HTMLElement>('[data-voice-controls]')!;
  const footer = toolbar.parentElement!;
  const participant = host!.querySelector<HTMLElement>(
    '[data-card="participant"]'
  )!;
  const share = host!.querySelector<HTMLElement>('[data-card="share"]')!;

  return { toolbar, footer, participant, share };
};

const rectangles = () => {
  const { share, participant, footer, toolbar } = elements();

  return [share, participant, footer, toolbar].map((element) => {
    const rect = element.getBoundingClientRect();

    return rect.toJSON();
  });
};

const reveal = async () => {
  const { share, footer } = elements();
  const target = page.elementLocator(share);
  await target.hover();
  await expect.poll(() => getComputedStyle(footer).opacity).toBe('1');
};

afterEach(async () => {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
  state.canSpeak = true;
  state.canReact = true;
  state.screenShareSupported = true;
  state.voiceOnlyMode = false;
  state.micMuted = false;
  state.webcamEnabled = false;
  state.sharingScreen = false;
  await page.viewport(1440, 900);
});

test.each([1188, 375])(
  'call toolbar fits the compact Paper geometry at %i px',
  async (width) => {
    await render(width);
    await reveal();
    const { toolbar, footer, participant } = elements();
    const rect = toolbar.getBoundingClientRect();
    const hostRect = host!.getBoundingClientRect();
    const participantRect = participant.getBoundingClientRect();
    expect(rect.width).toBe(280);
    expect(rect.height).toBe(50);
    expect(getComputedStyle(toolbar).padding).toBe('5px');
    expect(getComputedStyle(toolbar).gap).toBe('6px');
    expect(getComputedStyle(toolbar).backgroundColor).toBe('rgb(43, 45, 49)');
    expect(getComputedStyle(toolbar).borderRadius).toBe('25px');
    expect(footer.getBoundingClientRect().height).toBe(62);
    expect(hostRect.bottom - rect.bottom).toBe(12);
    expect(rect.top - participantRect.bottom).toBe(12);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      const buttonRect = button.getBoundingClientRect();
      // every control of the toolbar is a round button, the disconnect too
      expect(buttonRect.width).toBe(40);
      expect(buttonRect.height).toBe(40);
      expect(
        parseFloat(getComputedStyle(button).borderTopLeftRadius)
      ).toBeGreaterThanOrEqual(20);
      const icon = button.querySelector('svg')!;
      expect(icon.getBoundingClientRect().width).toBe(20);
      expect(icon.getBoundingClientRect().height).toBe(20);
    }
    if (width === 1188) {
      const screenshot = page.elementLocator(host!);
      await screenshot.screenshot({
        path: '.vitest/attachments/dod21-toolbar-visible.png'
      });
    }
  }
);

test('idle hiding and pointer reveal preserve content and footer rectangles', async () => {
  await render();
  await reveal();
  const { toolbar, footer, participant } = elements();
  const before = rectangles();
  await expect
    .poll(() => getComputedStyle(footer).opacity, { timeout: 4000 })
    .toBe('0');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('none');
  expect(rectangles()).toEqual(before);
  const screenshot = page.elementLocator(host!);
  await screenshot.screenshot({
    path: '.vitest/attachments/dod21-toolbar-hidden.png'
  });
  const target = page.elementLocator(participant);
  await target.hover();
  await expect.poll(() => getComputedStyle(footer).opacity).toBe('1');
  expect(rectangles()).toEqual(before);
});

test('Miku retains its palette and compact geometry when the toolbar hides and returns', async () => {
  await render(1188, 'hatsune-miku');
  await reveal();
  const { toolbar, footer } = elements();
  const before = rectangles();
  expect(document.documentElement.dataset.theme).toBe('hatsune-miku');
  expect(getComputedStyle(toolbar).backgroundColor).toBe('rgb(21, 28, 34)');
  expect(toolbar.getBoundingClientRect().width).toBe(280);
  expect(toolbar.getBoundingClientRect().height).toBe(50);
  await expect
    .poll(() => getComputedStyle(footer).opacity, { timeout: 4000 })
    .toBe('0');
  expect(rectangles()).toEqual(before);
  await reveal();
  expect(document.documentElement.dataset.theme).toBe('hatsune-miku');
  expect(getComputedStyle(toolbar).backgroundColor).toBe('rgb(21, 28, 34)');
  expect(rectangles()).toEqual(before);
});

test('Tab reveals hidden controls and keeps disabled microphone settings keyboard reachable', async () => {
  state.canSpeak = false;
  await render();
  const { toolbar, footer } = elements();
  expect(getComputedStyle(footer).opacity).toBe('0');
  await userEvent.tab();
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await expect.element(mute).toHaveFocus();
  expect(getComputedStyle(footer).opacity).toBe('1');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('auto');
  expect(getComputedStyle(mute.element()).boxShadow).not.toBe('none');
  await expect.element(mute).toHaveAttribute('aria-disabled', 'true');
  await userEvent.keyboard('{ArrowRight}');
  await new Promise((resolve) => setTimeout(resolve, 2700));
  expect(getComputedStyle(footer).opacity).toBe('1');
  await expect.element(mute).toHaveFocus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await expect
    .element(page.getByRole('dialog', { name: 'Microphone settings' }))
    .toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 2700));
  expect(getComputedStyle(footer).opacity).toBe('1');
  await userEvent.keyboard('{Escape}');
  await expect.element(mute).toHaveFocus();
  await userEvent.tab();
  await expect
    .element(page.getByRole('button', { name: 'Deafen', exact: true }))
    .toHaveFocus();
  await userEvent.tab({ shift: true });
  await expect.element(mute).toHaveFocus();
});

test('reaction popover holds the toolbar visible while focus is portaled and restores focus on Escape', async () => {
  await render();
  await reveal();
  const { toolbar, footer } = elements();
  const reaction = page.getByRole('button', {
    name: 'Send a reaction',
    exact: true
  });
  for (let index = 0; index < 5; index++) {
    await userEvent.tab();
  }
  await expect.element(reaction).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(toolbar.contains(document.activeElement)).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 2700));
  expect(getComputedStyle(footer).opacity).toBe('1');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('auto');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(reaction).toHaveFocus();
});

test('active media and muted microphone keep the compact control and icon sizes', async () => {
  state.micMuted = true;
  state.webcamEnabled = true;
  state.sharingScreen = true;
  await render();
  await reveal();
  const mute = page.getByRole('button', { name: 'Unmute', exact: true });
  const video = page.getByRole('button', { name: 'Stop Video', exact: true });
  const screen = page.getByRole('button', {
    name: 'Stop Sharing',
    exact: true
  });
  for (const control of [mute, video, screen]) {
    const button = control.element();
    const icon = button.querySelector('svg')!;
    expect(button.getBoundingClientRect().width).toBe(40);
    expect(button.getBoundingClientRect().height).toBe(40);
    expect(icon.getBoundingClientRect().width).toBe(20);
    expect(icon.getBoundingClientRect().height).toBe(20);
  }
  expect(getComputedStyle(mute.element()).color).toBe('rgb(245, 133, 143)');
  expect(getComputedStyle(video.element()).backgroundColor).toBe(
    'rgb(36, 128, 70)'
  );
  expect(getComputedStyle(screen.element()).backgroundColor).toBe(
    'rgb(36, 128, 70)'
  );
});

test('unavailable actions preserve conditional controls without overflowing', async () => {
  state.canReact = false;
  state.screenShareSupported = false;
  state.voiceOnlyMode = true;
  await render(375);
  await reveal();
  const { toolbar } = elements();
  expect(toolbar.querySelectorAll('button')).toHaveLength(4);
  await expect
    .element(page.getByRole('button', { name: 'Start Video', exact: true }))
    .toBeDisabled();
  const rect = toolbar.getBoundingClientRect();
  expect(rect.width).toBe(188);
  expect(rect.height).toBe(50);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(375);
});
