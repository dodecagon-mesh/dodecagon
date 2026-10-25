import { VoiceCardContextMenu } from '@/components/channel-view/voice/voice-card-context-menu';
import { VolumeControlProvider } from '@/components/voice-provider/volume-control-context';
import { LocalStorageKey } from '@/helpers/storage';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../i18n';
import '../index.css';

let root: Root;

afterEach(() => {
  root?.unmount();
  document.body.replaceChildren();
  localStorage.removeItem(LocalStorageKey.VOLUME_SETTINGS);
});

test('card volume is adjusted with pointer and keyboard without dismissing the menu', async () => {
  localStorage.removeItem(LocalStorageKey.VOLUME_SETTINGS);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(
      VolumeControlProvider,
      null,
      createElement(VoiceCardContextMenu, {
        volumeKey: 'user-2',
        children: createElement('button', null, 'Participant')
      })
    )
  );
  await page
    .getByRole('button', { name: 'Participant' })
    .click({ button: 'right' });
  const slider = page.getByRole('slider', { name: 'Volume', exact: true });
  await expect.element(slider).toHaveAttribute('aria-valuenow', '100');
  (slider.element() as HTMLElement).focus();
  await userEvent.keyboard('{Home}{ArrowRight}');
  await expect.element(slider).toHaveAttribute('aria-valuenow', '1');
  await expect.element(page.getByRole('menu')).toBeVisible();
  expect(
    JSON.parse(localStorage.getItem(LocalStorageKey.VOLUME_SETTINGS)!)
  ).toEqual({ 'user-2': 1 });
  await userEvent.keyboard('{Escape}');
  await page
    .getByRole('button', { name: 'Participant' })
    .click({ button: 'right' });
  await expect.element(slider).toHaveAttribute('aria-valuenow', '1');
  // the base ui slider keeps the focusable range input hidden, the visible
  // thumb carries the pointer
  const thumb = slider.element()?.closest('[data-slot="slider-thumb"]');

  (thumb as HTMLElement | null)?.click();
  await expect.element(page.getByRole('menu')).toBeVisible();
});

test('an unwatched stream has no Watch stream action', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(
      VolumeControlProvider,
      null,
      createElement(VoiceCardContextMenu, {
        demo: { isViewing: false, onToggle: () => {} },
        volumeKey: 'userscreen-2',
        children: createElement('button', null, 'Stream')
      })
    )
  );
  await page.getByRole('button', { name: 'Stream' }).click({ button: 'right' });
  await expect
    .element(page.getByRole('menuitem', { name: 'Watch stream', exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('menuitem', { name: 'Stop watching', exact: true }))
    .not.toBeInTheDocument();
});

test('the demo menu mutes the stream with a checkbox under the volume slider', async () => {
  localStorage.removeItem(LocalStorageKey.VOLUME_SETTINGS);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  root.render(
    createElement(
      VolumeControlProvider,
      null,
      createElement(VoiceCardContextMenu, {
        demo: { isViewing: true, onToggle: () => {} },
        volumeKey: 'userscreen-2',
        children: createElement('button', null, 'Stream')
      })
    )
  );
  await page.getByRole('button', { name: 'Stream' }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect.element(menu).toBeVisible();
  await expect
    .element(page.getByRole('menuitem', { name: 'Unpin stream', exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole('menuitem', { name: 'Pin stream', exact: true }))
    .not.toBeInTheDocument();
  const mute = page.getByRole('menuitemcheckbox', {
    name: 'Mute stream',
    exact: true
  });
  const slider = page.getByRole('slider', { name: 'Volume', exact: true });
  await expect.element(mute).toHaveAttribute('aria-checked', 'false');
  await expect.element(slider).toHaveAttribute('aria-valuenow', '100');
  await mute.click();
  await expect.element(mute).toHaveAttribute('aria-checked', 'true');
  await expect.element(slider).toHaveAttribute('aria-valuenow', '0');
  await expect.element(menu).toBeVisible();
  await mute.click();
  await expect.element(mute).toHaveAttribute('aria-checked', 'false');
  await expect.element(slider).toHaveAttribute('aria-valuenow', '100');
});
