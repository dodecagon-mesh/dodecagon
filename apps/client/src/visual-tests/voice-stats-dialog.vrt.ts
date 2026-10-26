import { DialogsProvider } from '@/components/dialogs';
import { VoiceControl } from '@/components/left-sidebar/voice-control';
import { closeOverlay } from '@/features/overlays/actions';
import { i18n } from '@/i18n';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../index.css';

vi.mock('@/components/devices-provider/hooks/use-devices', () => ({
  useDevices: () => ({
    devices: { voiceOnlyMode: false, noiseSuppression: 'none' }
  })
}));
vi.mock('@/features/server/channels/hooks', () => ({
  useChannelById: () => ({ name: 'Voice room' }),
  useCurrentVoiceChannelId: () => 42
}));
vi.mock('@/features/server/hooks', () => ({
  useCurrentVoicePeers: () => [],
  useChannelCan: () => () => true,
  useServerName: () => 'Test server',
  useCan: () => () => true,
  useHiddenPluginComponents: () => [],
  usePublicServerSettings: () => undefined,
  useUserRoles: () => []
}));
vi.mock('@/features/server/voice/hooks', () => ({
  useVoice: () => ({
    ownVoiceState: { webcamEnabled: false, sharingScreen: false },
    connectionStatus: 'connected',
    isScreenShareSupported: true,
    setVoiceOnlyMode: async () => true,
    toggleWebcam: () => {},
    toggleScreenShare: () => {}
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

afterEach(() => {
  closeOverlay();
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
});

test('advanced diagnostics from Wi-Fi stats mounts the real dialog with focus and releases modal input on close', async () => {
  await i18n.changeLanguage('en');
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;bottom:0;width:252px;height:96px';
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement('div', {
      children: [
        createElement(VoiceControl, { key: 'dock' }),
        createElement(DialogsProvider, { key: 'dialogs' })
      ]
    })
  );
  const stats = page.getByRole('button', {
    name: 'Transport Statistics',
    exact: true
  });
  await expect.element(stats).toBeVisible();
  await stats.click();
  await expect
    .element(page.getByRole('heading', { name: 'Transport Statistics' }))
    .toBeVisible();
  await page
    .getByRole('button', { name: 'Voice diagnostics', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: /Voice diagnostics/ });
  await expect.element(dialog).toBeVisible();
  await expect
    .element(page.getByRole('heading', { name: 'Transport Statistics' }))
    .not.toBeInTheDocument();
  await expect
    .poll(() => dialog.element().contains(document.activeElement))
    .toBe(true);
  // the base ui dialog marks the rest of the app as inert instead of taking
  // the pointer events of the body away
  expect(host?.hasAttribute('data-base-ui-inert')).toBe(true);
  await userEvent.keyboard('{Escape}');
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.poll(() => host?.hasAttribute('data-base-ui-inert')).toBe(false);
  await stats.click();
  await expect
    .element(page.getByRole('heading', { name: 'Transport Statistics' }))
    .toBeVisible();
});
