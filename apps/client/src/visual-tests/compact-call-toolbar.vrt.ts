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
    {
      ref: stageRef,
      'data-controls-active': isVisible,
      className:
        'voice-stage group/voice-stage relative flex size-full flex-col overflow-hidden'
    },
    createElement(VoiceGrid, {
      pinnedCardId: 'share',
      children: cards,
      isPresentation: true
    }),
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
  const stage = host!.querySelector<HTMLElement>('.voice-stage')!;

  return { toolbar, footer, participant, share, stage };
};

const waitForRender = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
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
  'call controls remain within the stage at %i px',
  async (width) => {
    await render(width);
    await reveal();
    const { toolbar } = elements();
    const rect = toolbar.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    if (width === 1188) {
      const screenshot = page.elementLocator(host!);
      await screenshot.screenshot({
        path: '.vitest/attachments/dod21-toolbar-visible.png'
      });
    }
  }
);

test('leaving the stage hides controls immediately and expands the presentation', async () => {
  await render();
  await reveal();
  const { toolbar, footer, share, stage } = elements();
  const before = footer.getBoundingClientRect().toJSON();
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('0');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('none');
  expect(footer.getBoundingClientRect().toJSON()).toEqual(before);
  const target = page.elementLocator(share);
  await target.hover();
  await expect.poll(() => getComputedStyle(footer).opacity).toBe('1');
  expect(footer.getBoundingClientRect().toJSON()).toEqual(before);
});

test('mouse focus does not keep controls or scrims visible after pointer exit', async () => {
  await render();
  await reveal();
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await mute.click();
  const { stage, footer } = elements();
  expect(mute.element().matches(':focus-visible')).toBe(false);
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('0');
  expect(
    getComputedStyle(stage.querySelector<HTMLElement>('.bg-linear-to-t')!)
      .opacity
  ).toBe('0');
});

test('a touch tap keeps controls reachable until the next outside tap', async () => {
  await render(375);
  const { stage, footer } = elements();
  stage.dispatchEvent(
    new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })
  );
  stage.dispatchEvent(
    new PointerEvent('pointerleave', { pointerType: 'touch' })
  );
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('1');
  document.body.dispatchEvent(
    new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })
  );
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('0');
});

test('focused scrims follow controls through pointer and keyboard visibility', async () => {
  await render();
  const scrims = host!.querySelectorAll<HTMLElement>(
    '.bg-linear-to-b, .bg-linear-to-t'
  );
  const { footer, stage } = elements();
  for (const scrim of scrims) {
    expect(getComputedStyle(scrim).opacity).toBe('0');
  }
  await reveal();
  for (const scrim of scrims) {
    expect(getComputedStyle(scrim).opacity).toBe('1');
  }
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  for (const scrim of scrims) {
    expect(getComputedStyle(scrim).opacity).toBe('0');
  }
  await userEvent.tab();
  expect(getComputedStyle(footer).opacity).toBe('1');
  for (const scrim of scrims) {
    expect(getComputedStyle(scrim).opacity).toBe('1');
  }
});

test('visible presentation controls reserve a separate strip and hidden controls release it', async () => {
  await render();
  const { share, participant, stage } = elements();
  const hiddenHeight = share.getBoundingClientRect().height;
  await reveal();
  const media = share.getBoundingClientRect();
  const thumbnail = participant.getBoundingClientRect();
  expect(media.bottom).toBeLessThanOrEqual(thumbnail.top - 8);
  expect(media.height).toBeLessThan(hiddenHeight);
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  expect(share.getBoundingClientRect().height).toBe(hiddenHeight);
  expect(
    getComputedStyle(participant.parentElement!.parentElement!.parentElement!)
      .opacity
  ).toBe('0');
});

test('Tab reveals hidden controls and keeps disabled microphone settings keyboard reachable', async () => {
  state.canSpeak = false;
  await render();
  const { toolbar, footer, stage } = elements();
  expect(getComputedStyle(footer).opacity).toBe('0');
  await userEvent.tab();
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await expect.element(mute).toHaveFocus();
  expect(getComputedStyle(footer).opacity).toBe('1');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('auto');
  expect(getComputedStyle(mute.element()).boxShadow).not.toBe('none');
  await expect.element(mute).toHaveAttribute('aria-disabled', 'true');
  await userEvent.keyboard('{ArrowRight}');
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('1');
  await expect.element(mute).toHaveFocus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await expect
    .element(page.getByRole('dialog', { name: 'Microphone settings' }))
    .toBeVisible();
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('1');
  await userEvent.keyboard('{Escape}');
  await expect.element(mute).toHaveFocus();
  await userEvent.tab();
  await expect
    .element(page.getByRole('button', { name: 'Start Video', exact: true }))
    .toHaveFocus();
  await userEvent.tab({ shift: true });
  await expect.element(mute).toHaveFocus();
});

test('reaction popover holds the toolbar visible while focus is portaled and restores focus on Escape', async () => {
  await render();
  await reveal();
  const { toolbar, footer, stage } = elements();
  const reaction = page.getByRole('button', {
    name: 'Send a reaction',
    exact: true
  });
  for (let index = 0; index < 4; index++) {
    await userEvent.tab();
  }
  await expect.element(reaction).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(toolbar.contains(document.activeElement)).toBe(false);
  stage.dispatchEvent(new PointerEvent('pointerleave'));
  await waitForRender();
  expect(getComputedStyle(footer).opacity).toBe('1');
  expect(getComputedStyle(toolbar).pointerEvents).toBe('auto');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expect.element(reaction).toHaveFocus();
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
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(375);
});
