import { Dialog } from '@/components/dialogs/dialogs';
import { resetAllShortcutBindings } from '@/features/app/actions';
import { openDialog, resetDialogs } from '@/features/dialogs/actions';
import { dialogInfoSelector } from '@/features/dialogs/selectors';
import { closeServerScreens } from '@/features/server-screens/actions';
import { setPublicServerSettings } from '@/features/server/actions';
import {
  setCurrentVoiceChannelId,
  setSelectedChannelId
} from '@/features/server/channels/actions';
import {
  channelsSelector,
  currentVoiceChannelIdSelector,
  selectedChannelIdSelector
} from '@/features/server/channels/selectors';
import { publicServerSettingsSelector } from '@/features/server/selectors';
import { updateOwnVoiceState } from '@/features/server/voice/actions';
import { ownVoiceStateSelector } from '@/features/server/voice/selectors';
import { store } from '@/features/store';
import { LocalStorageKey } from '@/helpers/storage';
import { TestId } from '@dodecagon/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

let root: Root;

const voiceState = () => ownVoiceStateSelector(store.getState());

const dispatchKey = (
  init: KeyboardEventInit,
  target: EventTarget = document.body
) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init
  });
  target.dispatchEvent(event);
  return event;
};

beforeAll(async () => {
  localStorage.clear();
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

beforeEach(async () => {
  resetAllShortcutBindings();
  resetDialogs();
  closeServerScreens();
  updateOwnVoiceState({ micMuted: false, soundMuted: false });
  setSelectedChannelId(1);
  await expect
    .element(
      page.getByRole('button', { name: /^(Open|Close) Members Sidebar$/ })
    )
    .toBeVisible();
  const closeMembers = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Close Members Sidebar"]'
  );
  if (closeMembers) await userEvent.click(closeMembers);
  await expect
    .element(page.getByRole('button', { name: 'Open Members Sidebar' }))
    .toBeVisible();
});

afterAll(() => root.unmount());

test('Discord deafen shortcut mutes audio and restores the previous microphone state', async () => {
  await userEvent.keyboard('{Control>}{Shift>}D{/Shift}{/Control}');
  await expect
    .poll(voiceState)
    .toMatchObject({ soundMuted: true, micMuted: true });
  await userEvent.keyboard('{Control>}{Shift>}M{/Shift}{/Control}');
  expect(voiceState().micMuted).toBe(true);
  await userEvent.keyboard('{Control>}{Shift>}D{/Shift}{/Control}');
  await expect
    .poll(voiceState)
    .toMatchObject({ soundMuted: false, micMuted: false });
});

test('Discord settings shortcut opens user settings without typing a comma', async () => {
  await page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).click();
  await userEvent.keyboard('{Control>},{/Control}');
  await expect
    .element(page.getByRole('heading', { name: 'User Settings', exact: true }))
    .toBeVisible();
});

test('Discord search shortcut opens the existing search dialog and focuses its input', async () => {
  await userEvent.keyboard('{Control>}{Shift>}F{/Shift}{/Control}');
  await expect.element(page.getByTestId(TestId.SEARCH_INPUT)).toHaveFocus();
});

test('search shortcuts respect the server search setting', async () => {
  const settings = publicServerSettingsSelector(store.getState())!;
  setPublicServerSettings({ ...settings, enableSearch: false });
  try {
    await userEvent.keyboard(
      '{Control>}k{/Control}{Control>}{Shift>}F{/Shift}{/Control}'
    );
    expect(dialogInfoSelector(store.getState()).isOpen).toBe(false);
  } finally {
    setPublicServerSettings(settings);
  }
});

test('Alt arrows navigate text channels without joining voice', async () => {
  const channels = channelsSelector(store.getState());
  const announcements = channels.find(({ name }) => name === 'announcements')!;
  await page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).click();
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await expect
    .poll(() => selectedChannelIdSelector(store.getState()))
    .toBe(announcements.id);
  expect(currentVoiceChannelIdSelector(store.getState())).toBeUndefined();
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
  await expect.poll(() => selectedChannelIdSelector(store.getState())).toBe(1);
});

test('Discord member shortcut toggles the existing sidebar outside text inputs', async () => {
  await userEvent.keyboard('{Control>}u{/Control}');
  await expect
    .element(page.getByRole('button', { name: 'Close Members Sidebar' }))
    .toBeVisible();
  await userEvent.keyboard('{Control>}u{/Control}');
  await expect
    .element(page.getByRole('button', { name: 'Open Members Sidebar' }))
    .toBeVisible();
});

test('member shortcut opens the mobile drawer without changing the desktop preference', async () => {
  const desktopPreference = localStorage.getItem(
    LocalStorageKey.RIGHT_SIDEBAR_STATE
  );
  let drawerOpen = false;
  try {
    for (const width of [390, 900, 1023]) {
      await page.viewport(width, 844);
      await userEvent.keyboard('{Control>}u{/Control}');
      drawerOpen = true;
      const heading = page.getByRole('heading', { name: /^Members.+5$/ });
      await expect
        .poll(() => {
          const element = heading.element();
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth;
        })
        .toBe(true);
      expect(localStorage.getItem(LocalStorageKey.RIGHT_SIDEBAR_STATE)).toBe(
        desktopPreference
      );
      await userEvent.keyboard('{Control>}u{/Control}');
      drawerOpen = false;
      await expect.element(heading).not.toBeInTheDocument();
    }
  } finally {
    if (drawerOpen) await userEvent.keyboard('{Control>}u{/Control}');
    await page.viewport(1440, 900);
  }
});

test('Discord shortcut reference opens and closes with Ctrl slash', async () => {
  await userEvent.keyboard('{Control>}/{/Control}');
  await expect
    .element(page.getByRole('heading', { name: 'Keyboard Shortcuts' }))
    .toBeVisible();
  await userEvent.keyboard('{Control>}/{/Control}');
  await expect
    .element(page.getByRole('heading', { name: 'Keyboard Shortcuts' }))
    .not.toBeInTheDocument();
});

test('Discord return-to-call shortcut selects only the already joined channel', async () => {
  setCurrentVoiceChannelId(2);
  try {
    await userEvent.keyboard(
      '{Control>}{Shift>}{Alt>}V{/Alt}{/Shift}{/Control}'
    );
    await expect
      .poll(() => selectedChannelIdSelector(store.getState()))
      .toBe(2);
    expect(currentVoiceChannelIdSelector(store.getState())).toBe(2);
  } finally {
    setCurrentVoiceChannelId(undefined);
    setSelectedChannelId(1);
  }
});

test('return-to-call stays idle when no voice channel is joined', async () => {
  await userEvent.keyboard('{Control>}{Shift>}{Alt>}V{/Alt}{/Shift}{/Control}');
  expect(selectedChannelIdSelector(store.getState())).toBe(1);
  expect(currentVoiceChannelIdSelector(store.getState())).toBeUndefined();
});

test('channel navigation stops at the first and last accessible text channel', async () => {
  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
  expect(selectedChannelIdSelector(store.getState())).toBe(1);
  await userEvent.keyboard('{Alt>}{ArrowDown}{ArrowDown}{/Alt}');
  const lastChannelId = selectedChannelIdSelector(store.getState());
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  expect(selectedChannelIdSelector(store.getState())).toBe(lastChannelId);
  expect(currentVoiceChannelIdSelector(store.getState())).toBeUndefined();
});

test('holding a shortcut never repeats a toggle or falls through to browser shortcuts', () => {
  const event = dispatchKey({
    code: 'KeyM',
    key: 'M',
    ctrlKey: true,
    shiftKey: true,
    repeat: true
  });
  expect(event.defaultPrevented).toBe(true);
  expect(voiceState().micMuted).toBe(false);
});

test('physical shortcuts support Cyrillic layouts and the macOS Command modifier', async () => {
  dispatchKey({ code: 'KeyM', key: 'Ь', ctrlKey: true, shiftKey: true });
  await expect.poll(() => voiceState().micMuted).toBe(true);
  dispatchKey({ code: 'KeyM', key: 'Ь', metaKey: true, shiftKey: true });
  await expect.poll(() => voiceState().micMuted).toBe(false);
});

test('composition, consumed events and unrelated modifier combinations stay untouched', () => {
  for (const init of [
    { isComposing: true, ctrlKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true, altKey: true },
    { ctrlKey: true, shiftKey: true, metaKey: true },
    { shiftKey: true },
    { ctrlKey: true }
  ]) {
    const event = dispatchKey({ code: 'KeyM', key: 'M', ...init });
    expect(event.defaultPrevented).toBe(false);
    expect(voiceState().micMuted).toBe(false);
  }
  const consumed = new KeyboardEvent('keydown', {
    code: 'KeyM',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  });
  consumed.preventDefault();
  document.body.dispatchEvent(consumed);
  expect(voiceState().micMuted).toBe(false);
});

test('shortcuts do not replace an existing dialog or navigate behind it', async () => {
  openDialog(Dialog.TEXT_INPUT, { title: 'Keep this dialog open' });
  await expect
    .element(page.getByRole('heading', { name: 'Keep this dialog open' }))
    .toBeVisible();
  await userEvent.keyboard(
    '{Alt>}{ArrowDown}{/Alt}{Control>}/{/Control}{Control>}k{/Control}'
  );
  expect(dialogInfoSelector(store.getState()).openDialog).toBe(
    Dialog.TEXT_INPUT
  );
  expect(selectedChannelIdSelector(store.getState())).toBe(1);
  await userEvent.keyboard('{Control>}{Shift>}M{/Shift}{/Control}');
  await expect.poll(() => voiceState().micMuted).toBe(true);
});

test('Ctrl U preserves text formatting and Ctrl K still opens search', async () => {
  const toggle = page.getByRole('button', { name: 'Open Members Sidebar' });
  await page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).click();
  await userEvent.keyboard('{Control>}u{/Control}underlined');
  const editor = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR).element();
  await expect
    .poll(() => editor.querySelector('u')?.textContent)
    .toBe('underlined');
  await userEvent.keyboard('{Control>}a{/Control}{Backspace}');
  await expect.element(toggle).toBeVisible();
  await userEvent.keyboard('{Control>}k{/Control}');
  await expect.element(page.getByTestId(TestId.SEARCH_INPUT)).toHaveFocus();
});

test('Discord mute shortcut toggles the real voice state while composing', async () => {
  const editor = page.getByTestId(TestId.MESSAGE_COMPOSE_EDITOR);
  await editor.click();
  await userEvent.keyboard('{Control>}{Shift>}M{/Shift}{/Control}');
  await expect.poll(() => voiceState().micMuted).toBe(true);
  await userEvent.keyboard('{Control>}{Shift>}M{/Shift}{/Control}');
  await expect.poll(() => voiceState().micMuted).toBe(false);
});

const openKeybindings = async () => {
  await page.getByTestId(TestId.USER_SETTINGS_TRIGGER).click();
  await page.getByRole('button', { name: 'Keybindings', exact: true }).click();
};

test('recorded microphone shortcut replaces the default and updates help and hints', async () => {
  await openKeybindings();
  await page
    .getByRole('button', {
      name: 'Record shortcut for Toggle microphone',
      exact: true
    })
    .click();
  const captured = dispatchKey({
    code: 'KeyM',
    key: 'm',
    ctrlKey: true,
    altKey: true
  });
  expect(captured.defaultPrevented).toBe(true);
  expect(voiceState().micMuted).toBe(false);
  await expect
    .element(
      page.getByText('Shortcut for Toggle microphone saved: Ctrl+Alt+M.', {
        exact: true
      })
    )
    .toBeVisible();

  closeServerScreens();
  dispatchKey({ code: 'KeyM', key: 'M', ctrlKey: true, shiftKey: true });
  expect(voiceState().micMuted).toBe(false);
  dispatchKey({ code: 'KeyM', key: 'm', ctrlKey: true, altKey: true });
  await expect.poll(() => voiceState().micMuted).toBe(true);
  await expect
    .element(
      page.getByRole('button', { name: 'Unmute microphone', exact: true })
    )
    .toHaveAttribute('title', 'Unmute microphone (Ctrl+Alt+M)');

  await userEvent.keyboard('{Control>}/{/Control}');
  await expect
    .element(page.getByRole('dialog').getByText('Ctrl+Alt+M', { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByRole('dialog').getByText('Ctrl+Shift+M', { exact: true })
    )
    .not.toBeInTheDocument();
});

test('removing a shortcut disables its action and restoring the default makes it execute again', async () => {
  await openKeybindings();
  await page
    .getByRole('button', {
      name: 'Remove shortcut for Toggle microphone',
      exact: true
    })
    .click();
  await expect
    .element(
      page.getByText('Shortcut for Toggle microphone removed.', { exact: true })
    )
    .toBeVisible();
  closeServerScreens();
  dispatchKey({ code: 'KeyM', key: 'M', ctrlKey: true, shiftKey: true });
  expect(voiceState().micMuted).toBe(false);

  await openKeybindings();
  await page
    .getByRole('button', {
      name: 'Restore default shortcut for Toggle microphone',
      exact: true
    })
    .click();
  await expect
    .element(
      page.getByText('Default shortcut for Toggle microphone restored.', {
        exact: true
      })
    )
    .toBeVisible();
  closeServerScreens();
  dispatchKey({ code: 'KeyM', key: 'M', ctrlKey: true, shiftKey: true });
  await expect.poll(() => voiceState().micMuted).toBe(true);
});

test('recording rejects conflicts and debug keys without executing voice or debug actions', async () => {
  await openKeybindings();
  await page
    .getByRole('button', {
      name: 'Record shortcut for Toggle microphone',
      exact: true
    })
    .click();
  dispatchKey({ code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true });
  await expect.element(page.getByRole('alert')).toBeVisible();
  expect(voiceState()).toMatchObject({ micMuted: false, soundMuted: false });
  for (const code of ['F4', 'F5', 'F9']) {
    const event = dispatchKey({ code, key: code });
    expect(event.defaultPrevented).toBe(true);
    expect(dialogInfoSelector(store.getState()).isOpen).toBe(false);
  }
  await expect.element(page.getByRole('alert')).toBeVisible();
  dispatchKey({
    code: 'KeyM',
    key: 'Process',
    ctrlKey: true,
    altKey: true,
    isComposing: true
  });
  dispatchKey({
    code: 'KeyM',
    key: 'm',
    ctrlKey: true,
    altKey: true,
    repeat: true
  });
  await expect
    .element(
      page.getByRole('button', {
        name: 'Cancel recording for Toggle microphone',
        exact: true
      })
    )
    .toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect
    .element(page.getByRole('heading', { name: 'User Settings', exact: true }))
    .toBeVisible();
  closeServerScreens();
  dispatchKey({ code: 'KeyM', key: 'M', ctrlKey: true, shiftKey: true });
  await expect.poll(() => voiceState().micMuted).toBe(true);
});

test('keyboard users can cancel capture with Tab and restore all defaults', async () => {
  await openKeybindings();
  const record = page.getByRole('button', {
    name: 'Record shortcut for Toggle microphone',
    exact: true
  });
  await record.click();
  await userEvent.keyboard('{Tab}');
  await expect
    .element(
      page.getByRole('button', {
        name: 'Remove shortcut for Toggle microphone',
        exact: true
      })
    )
    .toHaveFocus();
  await expect.element(record).toHaveAttribute('aria-pressed', 'false');
  await page
    .getByRole('button', {
      name: 'Remove shortcut for Toggle microphone',
      exact: true
    })
    .click();
  await page
    .getByRole('button', {
      name: 'Remove shortcut for Toggle deafen',
      exact: true
    })
    .click();
  await page
    .getByRole('button', { name: 'Restore all defaults', exact: true })
    .click();
  await expect
    .element(page.getByText('All default shortcuts restored.', { exact: true }))
    .toBeVisible();
  closeServerScreens();
  dispatchKey({ code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true });
  await expect
    .poll(voiceState)
    .toMatchObject({ soundMuted: true, micMuted: true });
});
