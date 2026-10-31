import { Network } from '@/components/server-screens/user-settings/network';
import { i18n } from '@/i18n';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';

vi.mock('@/features/server/hooks', () => ({
  usePublicServerSettings: () => ({
    webRtcStunUrls: ['stun:one.example.org:3478', 'stun:two.example.org:3478']
  })
}));

let nextSdp = '';

const sdpWith = (ports: number[]) =>
  [
    'v=0',
    't=0 0',
    ...ports.map(
      (port) =>
        `a=candidate:x${port} 1 udp 1686052607 203.0.113.9 ${port} typ srflx raddr 192.168.0.102 rport 54321 generation 0`
    )
  ].join('\r\n');

// the check reads what a browser gather produces, so the page is rendered against
// the gather result instead of a network
class FakePeerConnection {
  iceGatheringState = 'new';
  localDescription: { sdp: string } | null = null;
  private readonly listeners = new Set<() => void>();

  createDataChannel(): void {}

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: '' };
  }

  async setLocalDescription(): Promise<void> {
    this.localDescription = { sdp: nextSdp };

    queueMicrotask(() => {
      this.iceGatheringState = 'complete';
      for (const listener of this.listeners) listener();
    });
  }

  addEventListener(_event: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_event: string, listener: () => void): void {
    this.listeners.delete(listener);
  }

  close(): void {}
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
});

const renderNetwork = async (ports: number[]) => {
  nextSdp = sdpWith(ports);
  Object.assign(globalThis, { RTCPeerConnection: FakePeerConnection });

  await i18n.changeLanguage('en');

  host = document.createElement('div');
  host.style.cssText = 'width:760px;padding:24px;background:var(--background)';
  document.body.append(host);

  root = createRoot(host);
  root.render(createElement(Network));
};

test('a stable mapping reads as a network that supports easy connections', async () => {
  await renderNetwork([46329, 46329]);

  await expect
    .element(
      page.getByText(
        "You're on a network that supports easy connections with all devices."
      )
    )
    .toBeVisible();
  await expect
    .element(
      page.getByText('stun:one.example.org:3478, stun:two.example.org:3478')
    )
    .toBeVisible();
  await expect.element(page.getByText('Distinct public ports')).toBeVisible();

  // the card is what the check produces, and it carries no clock, so the
  // reference stays valid across runs
  await expect(
    page.elementLocator(document.querySelector('[role="status"]')!)
  ).toMatchScreenshot('network-status-open', { timeout: 3_000 });
});

test('a mapping that drifts per destination warns about restricted connections', async () => {
  await renderNetwork([46329, 46329]);
  await expect.element(page.getByText('Check again')).toBeVisible();

  nextSdp = sdpWith([46329, 51117]);
  await page.getByText('Check again').click();

  await expect
    .element(page.getByText('Your network restricts direct connections.'))
    .toBeVisible();

  await expect(
    page.elementLocator(document.querySelector('[role="status"]')!)
  ).toMatchScreenshot('network-status-symmetric', { timeout: 3_000 });
});
