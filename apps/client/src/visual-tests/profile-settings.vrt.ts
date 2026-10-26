import { ServerScreen } from '@/components/server-screens/screens';
import { closeOverlay, openOverlay } from '@/features/overlays/actions';
import { setCurrentVoiceChannelId } from '@/features/server/channels/actions';
import { updateOwnVoiceState } from '@/features/server/voice/actions';
import { TestId } from '@dodecagon/shared';
import type { CDPSession } from '@vitest/browser-playwright';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

let root: Root;

beforeAll(async () => {
  localStorage.clear();
  localStorage.setItem('vite-ui-theme', 'hatsune-miku');
  document.body.replaceChildren();

  for (const id of ['root', 'portal', 'imagePortal']) {
    const element = document.createElement('div');
    element.id = id;
    document.body.append(element);
  }

  const { ClientApp } = await import('../main');
  root = createRoot(document.getElementById('root')!);
  root.render(createElement(ClientApp));
  await page.getByTestId(TestId.CONNECT_IDENTITY_INPUT).fill('rnd332');
  await page.getByTestId(TestId.CONNECT_PASSWORD_INPUT).fill('password123');
  await page.getByTestId(TestId.CONNECT_BUTTON).click();
  await page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'general' })
    .click();
});

afterAll(() => root.unmount());

afterEach(async () => {
  closeOverlay();
  setCurrentVoiceChannelId(undefined);
  updateOwnVoiceState({ micMuted: false, soundMuted: false });
  await page.viewport(1440, 900);
});

test.each([1440, 768])(
  'desktop profile settings at %ipx stay visible and open the existing settings with the keyboard',
  async (width) => {
    await page.viewport(width, 900);
    const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
    const settings = sidebar.getByTestId(TestId.USER_SETTINGS_TRIGGER);

    await expect.element(settings).toBeVisible();
    await expect.element(settings).toHaveAccessibleName('User settings');
    const deafen = sidebar.getByRole('button', { name: /^Deafen/ });
    const deafenButton = deafen.element();
    deafenButton.focus();
    await userEvent.keyboard('{Tab}');
    await expect.element(settings).toHaveFocus();
    const settingsButton = settings.element();
    expect(getComputedStyle(settingsButton).boxShadow).not.toBe('none');
    await userEvent.keyboard('{Enter}');
    const heading = page.getByRole('heading', {
      name: 'Profile',
      exact: true,
      level: 2
    });
    await expect.element(heading).toBeVisible();
    const mainRegion = page.getByRole('main');
    const settingsMain = mainRegion.filter({ has: heading });
    const settingsMainElement = settingsMain.element();
    const settingsMainBounds = settingsMainElement.getBoundingClientRect();
    expect(settingsMainBounds.top).toBe(0);
    await expect
      .element(page.getByText('Esc to close', { exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(heading).not.toBeInTheDocument();
    deafenButton.focus();
    await userEvent.keyboard('{Tab}{Space}');
    await expect.element(heading).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('hatsune-miku');
    expect(localStorage.getItem('vite-ui-theme')).toBe('hatsune-miku');
  }
);

test('profile controls retain the Paper spacing and Miku theme without crowding presence or disconnect', async () => {
  setCurrentVoiceChannelId(2);
  const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
  const settings = sidebar.getByTestId(TestId.USER_SETTINGS_TRIGGER);
  await expect.element(settings).toBeVisible();
  await document.fonts.ready;
  const microphone = sidebar.getByRole('button', { name: /^Mute microphone/ });
  const deafen = sidebar.getByRole('button', { name: /^Deafen/ });
  const disconnect = sidebar.getByRole('button', {
    name: 'Disconnect',
    exact: true
  });
  await expect.element(disconnect).toBeVisible();
  const gear = settings.element();
  const controls = gear.parentElement!;
  const row = controls.parentElement!;
  const identity = controls.previousElementSibling!;
  const rowBounds = row.getBoundingClientRect();
  const identityBounds = identity.getBoundingClientRect();
  const buttons = [microphone.element(), deafen.element(), gear];
  const buttonBounds = buttons.map((button) => button.getBoundingClientRect());

  expect(rowBounds.height).toBe(52);
  expect(getComputedStyle(row).paddingInline).toBe('10px');
  expect(getComputedStyle(row).backgroundColor).toBe('rgb(16, 20, 24)');
  expect(identityBounds.left - rowBounds.left).toBe(10);
  expect(buttonBounds[0].left - identityBounds.right).toBe(6);
  expect(rowBounds.right - buttonBounds[2].right).toBe(10);

  for (const [index, button] of buttons.entries()) {
    const bounds = buttonBounds[index];
    const icon = button.querySelector('svg')!;
    const iconBounds = icon.getBoundingClientRect();
    expect(bounds.width).toBe(32);
    expect(bounds.height).toBe(32);
    expect(bounds.top - rowBounds.top).toBe(10);
    expect(iconBounds.width).toBe(20);
    expect(iconBounds.height).toBe(20);
    expect(iconBounds.left - bounds.left).toBe(6);
    expect(iconBounds.top - bounds.top).toBe(6);
    if (index > 0) {
      expect(bounds.left - buttonBounds[index - 1].right).toBe(6);
    }
  }

  await expect
    .element(sidebar.getByText('online', { exact: true }))
    .toBeVisible();
  const disconnectButton = disconnect.element();
  const disconnectBounds = disconnectButton.getBoundingClientRect();
  expect(disconnectBounds.bottom).toBeLessThanOrEqual(rowBounds.top);
  expect(disconnectBounds.right).toBeLessThanOrEqual(rowBounds.right - 10);
  expect(document.documentElement.dataset.theme).toBe('hatsune-miku');
  await page.screenshot({
    element: row,
    path: '../../.vitest/profile-settings.png'
  });
});

test('the profile banner menu opens to the right of the profile card and closes without trapping the focus', async () => {
  openOverlay({ kind: 'serverScreen', name: ServerScreen.USER_SETTINGS });

  const heading = page.getByRole('heading', {
    name: 'Profile',
    exact: true,
    level: 2
  });

  await expect.element(heading).toBeVisible();

  const banner = page.getByRole('button', { name: 'Change banner' });

  await expect.element(banner).toBeVisible();

  await banner.click();

  const menu = page.getByRole('menu');

  await expect.element(menu).toBeVisible();

  const bannerBounds = banner.element().getBoundingClientRect();
  const menuBounds = menu.element().getBoundingClientRect();

  expect(menuBounds.left).toBeGreaterThanOrEqual(bannerBounds.right);

  await userEvent.keyboard('{Escape}');

  await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  await expect.element(banner).toHaveFocus();
  await expect.element(heading).toBeVisible();
});

test('mobile profile settings keep the settings navigation reachable and keyboard accessible', async () => {
  await page.viewport(390, 844);
  const session: CDPSession = cdp();
  const frame = window.frameElement;
  const frameBounds = frame?.getBoundingClientRect();
  const x = (frameBounds?.left ?? 0) + 24;
  const y = (frameBounds?.top ?? 0) + 180;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }]
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 160, y }]
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  });

  const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
  const settings = sidebar.getByTestId(TestId.USER_SETTINGS_TRIGGER);
  await expect
    .poll(() => {
      const button = settings.element();
      const bounds = button.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    })
    .toBe(true);
  await expect.element(settings).toBeVisible();
  const settingsButton = settings.element();
  const settingsBounds = settingsButton.getBoundingClientRect();
  expect(settingsBounds.width).toBe(32);
  expect(settingsBounds.height).toBe(32);
  expect(settingsBounds.top).toBeGreaterThanOrEqual(0);
  expect(settingsBounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  const deafen = sidebar.getByRole('button', { name: /^Deafen/ });
  const deafenButton = deafen.element();
  deafenButton.focus();
  await userEvent.keyboard('{Tab}');
  await expect.element(settings).toHaveFocus();
  await userEvent.keyboard('{Space}');
  await userEvent.unhover(document.body);
  const heading = page.getByRole('heading', {
    name: 'Profile',
    exact: true,
    level: 2
  });
  await expect.element(heading).toBeVisible();
  await expect
    .poll(() => {
      const sidebarElement = sidebar.element();
      const sidebarBounds = sidebarElement.getBoundingClientRect();

      return sidebarBounds.right;
    })
    .toBeLessThanOrEqual(0);
  const mainRegion = page.getByRole('main');
  const settingsMain = mainRegion.filter({ has: heading });
  const settingsMainElement = settingsMain.element();
  const settingsMainBounds = settingsMainElement.getBoundingClientRect();
  expect(settingsMainBounds.top).toBe(0);
  const navigationToggle = page.getByRole('button', {
    name: 'Settings navigation',
    exact: true
  });
  await expect.element(navigationToggle).toBeVisible();
  await expect
    .element(navigationToggle)
    .toHaveAttribute('aria-expanded', 'false');
  const navigationSidebarElement = document.getElementById('settings-sidebar')!;
  await expect
    .element(page.elementLocator(navigationSidebarElement))
    .not.toBeVisible();
  const navigation = page.getByRole('navigation', {
    name: 'Settings navigation',
    exact: true
  });
  await navigationToggle.click();
  await expect
    .element(navigationToggle)
    .toHaveAttribute('aria-expanded', 'true');
  await expect.element(navigation).toBeVisible();
  await expect
    .poll(() => {
      const navigationElement = navigation.element();
      const navigationBounds = navigationElement.getBoundingClientRect();

      return navigationBounds.left;
    })
    .toBeGreaterThanOrEqual(0);
  expect(
    navigation.element().getBoundingClientRect().right
  ).toBeLessThanOrEqual(390);
  const profileItem = navigation.getByRole('button', {
    name: 'Profile',
    exact: true
  });
  await expect.element(profileItem).toHaveAttribute('aria-current', 'page');
  await profileItem.click();
  await expect
    .element(navigationToggle)
    .toHaveAttribute('aria-expanded', 'false');
  await expect
    .element(page.elementLocator(navigationSidebarElement))
    .not.toBeVisible();
  const closeSettings = page.getByRole('button', {
    name: 'Close',
    exact: true
  });
  await expect.element(closeSettings).toBeVisible();
  await closeSettings.click();
  await expect.element(heading).not.toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe('hatsune-miku');
  expect(localStorage.getItem('vite-ui-theme')).toBe('hatsune-miku');
});

test('mobile settings controls stay reachable while server settings scroll', async () => {
  await page.viewport(390, 400);
  openOverlay({ kind: 'serverScreen', name: ServerScreen.SERVER_SETTINGS });

  const heading = page.getByRole('heading', {
    name: 'Server overview',
    exact: true,
    level: 2
  });
  const mainRegion = page.getByRole('main');
  const settingsMain = mainRegion.filter({ has: heading });
  await expect.element(heading).toBeVisible();
  const main = settingsMain.element();
  expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
  main.scrollTop = main.scrollHeight;

  const navigationToggle = page.getByRole('button', {
    name: 'Settings navigation',
    exact: true
  });
  const closeSettings = page.getByRole('button', {
    name: 'Close',
    exact: true
  });
  await expect
    .poll(() => {
      const navigationToggleElement = navigationToggle.element();
      const navigationBounds = navigationToggleElement.getBoundingClientRect();
      const closeSettingsElement = closeSettings.element();
      const closeBounds = closeSettingsElement.getBoundingClientRect();

      return (
        navigationBounds.top >= 0 &&
        navigationBounds.bottom <= window.innerHeight &&
        closeBounds.top >= 0 &&
        closeBounds.bottom <= window.innerHeight
      );
    })
    .toBe(true);

  await navigationToggle.click();
  const navigation = page.getByRole('navigation', {
    name: 'Settings navigation',
    exact: true
  });
  await expect.element(navigation).toBeVisible();
  await closeSettings.click();
  await expect.element(heading).not.toBeInTheDocument();
});

test('Escape confirms before discarding unsaved profile changes', async () => {
  openOverlay({ kind: 'serverScreen', name: ServerScreen.USER_SETTINGS });

  const heading = page.getByRole('heading', {
    name: 'Profile',
    exact: true,
    level: 2
  });

  try {
    await expect.element(heading).toBeVisible();
    const bioTextbox = page.getByRole('textbox', { name: 'Bio' });
    await bioTextbox.fill('Unsaved profile bio');
    await userEvent.keyboard('{Escape}');

    const confirmation = page.getByRole('alertdialog');
    await expect.element(confirmation).toBeVisible();
    await expect
      .element(
        confirmation.getByText('Discard unsaved changes?', { exact: true })
      )
      .toBeVisible();
    const discardButton = confirmation.getByRole('button', {
      name: 'Discard',
      exact: true
    });
    await discardButton.click();
    await expect.element(heading).not.toBeInTheDocument();
  } finally {
    closeOverlay();
  }
});
