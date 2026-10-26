import { Dialog } from '@/components/dialogs/dialogs';
import { closeOverlay, openOverlay } from '@/features/overlays/actions';
import { overlaySelector } from '@/features/overlays/selectors';
import { store } from '@/features/store';
import '@/i18n';
import { TestId } from '@dodecagon/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
const imagePortal = document.createElement('div');
imagePortal.id = 'imagePortal';
document.body.append(imagePortal);

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const screenshot =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="gray"/></svg>';

afterEach(() => {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
  imagePortal.replaceChildren();
});

test('closing a dialog is synchronous and cannot erase a newly opened dialog', async () => {
  try {
    openOverlay({ kind: 'dialog', name: Dialog.CONFIRM_ACTION });
    closeOverlay();
    expect(overlaySelector(store.getState())).toBeUndefined();
    openOverlay({ kind: 'dialog', name: Dialog.VOICE_DEBUG });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const overlay = overlaySelector(store.getState());
    expect(overlay?.kind).toBe('dialog');
    expect(overlay?.name).toBe(Dialog.VOICE_DEBUG);
  } finally {
    closeOverlay();
  }
});

test('language selector uses normal padding in the compact header', async () => {
  const { LanguageSwitcher } = await import('@/components/language-switcher');
  const { i18n } = await import('@/i18n');
  await i18n.changeLanguage('en');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement(LanguageSwitcher, { className: 'h-8 border-0' }));
  await expect.poll(() => host?.querySelector('button')).not.toBeNull();
  const trigger = host.querySelector('button')!;
  expect(getComputedStyle(trigger).paddingLeft).toBe('12px');
  expect(getComputedStyle(trigger).paddingRight).toBe('12px');
  expect(getComputedStyle(trigger).paddingTop).toBe('6px');
  expect(trigger.getBoundingClientRect().height).toBe(32);
});

test('marketplace screenshots change slides without JavaScript scrolling animation', async () => {
  const { MarketplaceScreenshots } =
    await import('@/components/server-screens/server-settings/plugins/marketplace/marketplace-screenshots');
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:600px';
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(MarketplaceScreenshots, {
      pluginId: 'motion-fixture',
      pluginName: 'Motion fixture',
      screenshots: Array.from({ length: 5 }, () => screenshot)
    })
  );
  await nextFrame();
  await nextFrame();
  const buttons = host.querySelectorAll('button');
  const next = buttons[1] as HTMLButtonElement;
  await expect.poll(() => next.disabled).toBe(false);
  const track = host.querySelector('img')!.parentElement!.parentElement!;
  next.click();
  const transforms: string[] = [];
  for (let frame = 0; frame < 6; frame++) {
    await nextFrame();
    transforms.push(getComputedStyle(track).transform);
  }
  expect(new Set(transforms).size).toBe(1);
  expect(transforms[0]).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
  (buttons[0] as HTMLButtonElement).click();
  await nextFrame();
  expect(getComputedStyle(track).transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
});

test('fullscreen image opens and closes without transition timers', async () => {
  const { FullScreenImage } =
    await import('@/components/fullscreen-image/content');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(FullScreenImage, { src: screenshot, alt: 'Motion preview' })
  );
  await nextFrame();
  await page.getByRole('img', { name: 'Motion preview' }).click();
  await nextFrame();
  expect(imagePortal.childElementCount).toBeGreaterThan(0);
  expect(getComputedStyle(imagePortal.firstElementChild!).opacity).toBe('1');
  const close = imagePortal.querySelector<HTMLButtonElement>(
    `[data-testid="${TestId.FULLSCREEN_IMAGE_CLOSE}"]`
  )!;
  close.click();
  await nextFrame();
  expect(imagePortal.childElementCount).toBe(0);
});
