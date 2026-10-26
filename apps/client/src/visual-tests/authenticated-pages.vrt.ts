import { PinnedCardType } from '@/components/channel-view/voice/hooks/use-pin-card-controller';
import { Dialog } from '@/components/dialogs/dialogs';
import { ServerScreen } from '@/components/server-screens/screens';
import {
  closeThreadSidebar,
  closeVoiceChatSidebar,
  openThreadSidebar,
  openVoiceChatSidebar
} from '@/features/app/actions';
import {
  openDialog,
  requestConfirmation,
  resetDialogs
} from '@/features/dialogs/actions';
import { dialogInfoSelector } from '@/features/dialogs/selectors';
import {
  closeServerScreens,
  openServerScreen
} from '@/features/server-screens/actions';
import { markChannelAsRead, setDmsOpen } from '@/features/server/actions';
import {
  setCurrentVoiceChannelId,
  setSelectedChannelId
} from '@/features/server/channels/actions';
import {
  getMessageQueryClient,
  getMessageWindow,
  writeMessageWindow
} from '@/features/server/messages/database';
import { scrollToVirtualMessage } from '@/features/server/messages/helpers';
import { serverSliceActions } from '@/features/server/slice';
import {
  addUserToVoiceChannel,
  joinVoice,
  leaveVoice,
  setPinnedCard,
  updateOwnVoiceState
} from '@/features/server/voice/actions';
import { store } from '@/features/store';
import { clearVoiceDebugEvents } from '@/helpers/voice-debug';
import * as trpc from '@/lib/trpc';
import {
  MARKETPLACE_REGISTRY_URL,
  TestId,
  type TFile
} from '@dodecagon/shared';
import { toast } from 'sonner';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi
} from 'vitest';

import { page, userEvent } from 'vitest/browser';
vi.mock('@/lib/trpc', { spy: true });

const addRoot = (id: string) => {
  const element = document.createElement('div');
  element.id = id;
  document.body.append(element);
};

const snapshot = (name: string) =>
  expect(page).toMatchScreenshot(name, { timeout: 3_000 });

const messageAuthor = (name: string) => {
  const container = document.querySelector('[data-messages-container]')!;
  const history = page.elementLocator(container);
  return history.getByText(name, { exact: true });
};

const waitForRender = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
};

const revealVoiceControls = async () => {
  const stage = document.querySelector('.group\\/voice-stage');
  stage?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
  await waitForRender();
};

const createScreenShareStream = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is unavailable');

  context.fillStyle = '#12151a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#222731';
  context.fillRect(0, 0, canvas.width, 54);
  context.fillStyle = '#e4a054';
  context.fillRect(24, 20, 14, 14);
  context.font = '24px monospace';
  context.fillStyle = '#b2b8c1';
  context.fillText('screen-share.ts', 58, 34);

  const lines = [
    ['#76c49b', 'export function startScreenShare() {'],
    ['#b2b8c1', '  const stream = await navigator.mediaDevices'],
    ['#e4a054', '    .getDisplayMedia({ video: true });'],
    ['#b2b8c1', '  return connectDirectly(stream);'],
    ['#76c49b', '}']
  ] as const;

  context.font = '28px monospace';
  lines.forEach(([color, text], index) => {
    context.fillStyle = color;
    context.fillText(text, 72, 150 + index * 54);
  });

  return canvas.captureStream(1);
};

const addVoiceParticipants = (sharingUserId?: number) => {
  for (const userId of [3, 2, 1, 4]) {
    addUserToVoiceChannel(userId, 2, {
      micMuted: false,
      soundMuted: false,
      webcamEnabled: false,
      sharingScreen: userId === sharingUserId
    });
  }
};

const removeVoiceParticipants = () => {
  for (const userId of [1, 2, 3, 4]) {
    store.dispatch(
      serverSliceActions.removeUserFromVoiceChannel({
        userId: userId,
        channelId: 2
      })
    );
  }
};
const marketplaceEntries = [
  {
    plugin: {
      id: 'soundboard',
      name: 'Soundboard',
      description: 'Share polished sound effects in voice channels.',
      author: 'Sharkord',
      logo: 'https://localhost:1/soundboard.png',
      homepage: 'https://github.com/Sharkord/plugins',
      tags: ['voice'],
      categories: ['Fun'],
      verified: true,
      screenshots: []
    },
    versions: [
      {
        version: '1.2.0',
        downloadUrl:
          'https://github.com/Sharkord/plugins/releases/download/soundboard-1.2.0/plugin.tar.gz',
        checksum: 'visual-test-soundboard',
        sdkVersion: 1,
        size: 1_372_160,
        timestamp: Date.UTC(2026, 8, 28)
      }
    ]
  },
  {
    plugin: {
      id: 'moderation-toolkit',
      name: 'Moderation Toolkit',
      description: 'Practical moderation workflows and audit helpers.',
      author: 'Sharkord',
      logo: 'https://localhost:1/moderation.png',
      homepage: 'https://github.com/Sharkord/plugins',
      tags: ['moderation'],
      categories: ['Administration'],
      verified: true,
      screenshots: []
    },
    versions: [
      {
        version: '1.0.4',
        downloadUrl:
          'https://github.com/Sharkord/plugins/releases/download/moderation-1.0.4/plugin.tar.gz',
        checksum: 'visual-test-moderation',
        sdkVersion: 1,
        size: 983_040,
        timestamp: Date.UTC(2026, 8, 21)
      }
    ]
  }
];

const nativeFetch = window.fetch.bind(window);
const visualFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === MARKETPLACE_REGISTRY_URL) {
    return Promise.resolve(Response.json(marketplaceEntries));
  }

  return nativeFetch(input, init);
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  vi.stubGlobal('fetch', visualFetch);
  localStorage.clear();
  document.body.replaceChildren();
  addRoot('root');
  addRoot('portal');
  addRoot('imagePortal');

  const [{ createElement }, { createRoot }, { ClientApp }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../main')
  ]);
  createRoot(document.getElementById('root')!).render(createElement(ClientApp));
  await document.fonts.ready;
  await page.getByTestId(TestId.CONNECT_IDENTITY_INPUT).fill('rnd332');
  await page.getByTestId(TestId.CONNECT_PASSWORD_INPUT).fill('password123');
  await page.getByTestId(TestId.CONNECT_BUTTON).click();
  await page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'general' })
    .click();
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  resetDialogs();
  closeThreadSidebar();
  setDmsOpen(false);
  setSelectedChannelId(1);
  await waitForRender();

  document
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Close Members Sidebar"]'
    )
    ?.click();
});

afterEach(async () => {
  closeServerScreens();
  toast.dismiss();
  for (let attempt = 0; attempt < 20; attempt++) {
    await waitForRender();
    if (!document.querySelector('[data-sonner-toast]')) break;
  }
});

test('delete user asks for the typed confirmation and stays visibly destructive', async () => {
  const { store } = await import('@/features/store');
  const { userByIdSelector } =
    await import('@/features/server/users/selectors');
  const state = store.getState();
  const user = userByIdSelector(state, 2)!;
  openDialog(Dialog.DELETE_USER, { user, refetch: async () => undefined });
  const action = page.getByRole('button', { name: 'Delete user', exact: true });
  try {
    await expect.element(action).toBeVisible();
    await expect.element(action).toBeDisabled();
    const initialStyle = getComputedStyle(action.element());
    expect(initialStyle.backgroundColor).toBe('rgb(179, 38, 62)');
    expect(initialStyle.color).toBe('rgb(255, 255, 255)');
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await expect.element(action).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const currentState = store.getState();
    expect(userByIdSelector(currentState, user.id)).toBeDefined();
    await expect
      .poll(() => {
        const nextState = store.getState();
        const info = dialogInfoSelector(nextState);
        return info.openDialog;
      })
      .toBeUndefined();
  } finally {
    resetDialogs();
  }
});

test('plugin security confirmation keeps the countdown and destructive action', async () => {
  const { store } = await import('@/features/store');
  const onConfirm = vi.fn();
  openDialog(Dialog.PLUGIN_INSTALL_CONFIRM, {
    pluginName: 'E2E Plugin',
    onConfirm
  });
  const action = page.getByRole('button', { name: /^Wait \(/ });
  try {
    await expect.element(action).toBeVisible();
    await expect.element(action).toBeDisabled();
    const style = getComputedStyle(action.element());
    expect(style.backgroundColor).toBe('rgb(179, 38, 62)');
    expect(style.color).toBe('rgb(255, 255, 255)');
    expect(onConfirm).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(onConfirm).not.toHaveBeenCalled();
    await expect
      .poll(() => {
        const nextState = store.getState();
        const info = dialogInfoSelector(nextState);
        return info.openDialog;
      })
      .toBeUndefined();
  } finally {
    resetDialogs();
  }
});

test('destructive confirmation retains its danger color while Space is held', async () => {
  const { store } = await import('@/features/store');
  const result = requestConfirmation({
    title: 'Pressed fixture',
    confirmLabel: 'Pressed fixture',
    variant: 'danger'
  });
  const action = page.getByRole('button', {
    name: 'Pressed fixture',
    exact: true
  });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  let pressed = false;
  try {
    await expect.element(action).toBeVisible();
    const node = action.element();
    await userEvent.unhover(document.body);
    node.focus();
    await userEvent.keyboard('[Space>]');
    pressed = true;
    expect(node.matches(':hover')).toBe(false);
    expect(node.matches(':active')).toBe(true);
    await expect
      .poll(() => {
        context.clearRect(0, 0, 1, 1);
        const style = getComputedStyle(node);
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1);
        const [red, green, blue, alpha] = pixel.data;
        return (
          red > 150 &&
          green < 75 &&
          blue < 100 &&
          alpha === Math.round(255 * 0.8)
        );
      })
      .toBe(true);
  } finally {
    if (pressed) {
      await userEvent.keyboard('[/Space]');
      expect(await result).toBe(true);
    } else {
      const state = store.getState();
      const info = dialogInfoSelector(state);
      info.props.onCancel?.();
    }
    await expect
      .poll(() => {
        const state = store.getState();
        const info = dialogInfoSelector(state);
        return info.openDialog;
      })
      .toBeUndefined();
  }
});

test('destructive confirmations use a solid high-contrast action', async () => {
  const { store } = await import('@/features/store');
  const result = requestConfirmation({
    title: 'Delete fixture',
    message: 'This is a local appearance check.',
    confirmLabel: 'Delete fixture',
    variant: 'danger'
  });
  const action = page.getByRole('button', { name: 'Delete fixture' });
  try {
    await expect.element(action).toBeVisible();
    const style = getComputedStyle(action.element());
    expect(style.backgroundColor).toBe('rgb(179, 38, 62)');
    expect(style.color).toBe('rgb(255, 255, 255)');
    const dialog = page.getByRole('alertdialog').element();
    expect(getComputedStyle(dialog).backgroundColor).toBe('rgb(49, 51, 56)');
    expect(getComputedStyle(dialog).borderRadius).toBe('12px');
  } finally {
    const state = store.getState();
    const info = dialogInfoSelector(state);
    info.props.onCancel?.();
    expect(await result).toBe(false);
    await expect
      .poll(() => {
        const nextState = store.getState();
        const nextInfo = dialogInfoSelector(nextState);
        return nextInfo.openDialog;
      })
      .toBeUndefined();
  }
});

test.each(['channel', 'category'] as const)(
  '%s deletion confirmation uses the danger variant through its real menu',
  async (kind) => {
    const { store } = await import('@/features/store');
    const target =
      kind === 'channel'
        ? page.getByTestId(TestId.CHANNEL_ITEM).filter({ hasText: 'general' })
        : page.getByText('Text Channels', { exact: true });
    try {
      await target.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const action = page.getByRole('button', { name: 'Delete', exact: true });
      await expect.element(action).toBeVisible();
      expect(getComputedStyle(action.element()).backgroundColor).toBe(
        'rgb(179, 38, 62)'
      );
    } finally {
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
      if (cancel.query()) {
        await cancel.click();
        await expect
          .poll(() => {
            const state = store.getState();
            const info = dialogInfoSelector(state);
            return info.openDialog;
          })
          .toBeUndefined();
      }
      resetDialogs();
    }
  }
);

test('the shared shell uses compact headers without a global strip', async () => {
  await expect.element(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
  expect(document.querySelector('header')).toBeNull();
  expect(
    page
      .getByRole('button', {
        name: /Search messages, channels, and people Ctrl K/
      })
      .elements()
  ).toHaveLength(0);
  await expect.element(page.getByTestId(TestId.SEARCH_BUTTON)).toBeVisible();
  const sidebarHeader = page
    .getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME)
    .element().parentElement!;
  expect(sidebarHeader.getBoundingClientRect().height).toBe(48);
  const channelHeader = page
    .getByRole('button', { name: 'Open Members Sidebar' })
    .element().parentElement!.parentElement!.parentElement!;
  expect(channelHeader.getBoundingClientRect().height).toBe(48);

  await page.getByRole('button', { name: 'Open Members Sidebar' }).click();
  const membersHeader = page.getByRole('heading', { name: /^Members/ });
  await expect.element(membersHeader).toBeVisible();
  expect(
    membersHeader.element().parentElement!.getBoundingClientRect().height
  ).toBe(48);
  await page.getByRole('button', { name: 'Close Members Sidebar' }).click();

  openServerScreen(ServerScreen.USER_SETTINGS);
  await expect
    .element(page.getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY).first())
    .toBeVisible();
});

test('message authors align with the channel header icon', async () => {
  await expect
    .element(page.getByTestId(TestId.MESSAGE_ITEM).first())
    .toBeVisible();
  const firstMessage = document.querySelector<HTMLElement>(
    '[data-messages-container] [data-message-id]'
  )!;
  const authorGroup = firstMessage.closest('[data-message-group]')!;
  const channelHeader = page
    .getByRole('button', { name: 'Open Members Sidebar' })
    .element().parentElement!.parentElement!.parentElement!;
  expect(authorGroup.getBoundingClientRect().left).toBe(
    channelHeader.querySelector('svg')!.getBoundingClientRect().left
  );
});

test('reply links use the readable accent text color', async () => {
  const replies = page.getByRole('button', { name: '2 replies', exact: true });
  await expect.element(replies).toBeVisible();
  expect(getComputedStyle(replies.element()).color).toBe('rgb(174, 181, 255)');
});

test('message author typography and timestamps use the Paper hierarchy', async () => {
  const author = messageAuthor('aria');
  await expect.element(author).toBeVisible();
  const authorStyle = getComputedStyle(author.element());
  expect(authorStyle.fontSize).toBe('14px');
  expect(authorStyle.lineHeight).toBe('20px');
  expect(authorStyle.fontWeight).toBe('600');
  const content = page
    .getByTestId(TestId.MESSAGE_ITEM)
    .first()
    .element()
    .querySelector('.msg-content')!;
  expect(getComputedStyle(content).fontSize).toBe('16px');
  expect(getComputedStyle(content).lineHeight).toBe('24px');
  const timestamp = author.element().nextElementSibling!;
  expect(getComputedStyle(timestamp).color).toBe('rgb(176, 180, 188)');
});

test('message groups use Paper avatar and body spacing', async () => {
  const author = messageAuthor('aria');
  await expect.element(author).toBeVisible();
  const header = author.element().parentElement!;
  const body = header.parentElement!;
  const group = body.parentElement!;
  expect(getComputedStyle(group).columnGap).toBe('16px');
  expect(getComputedStyle(group).paddingTop).toBe('8px');
  expect(getComputedStyle(group).paddingLeft).toBe('0px');
  expect(group.firstElementChild!.getBoundingClientRect().width).toBe(38);
  expect(getComputedStyle(body).rowGap).toBe('4px');
  expect(getComputedStyle(header).columnGap).toBe('9px');
  expect(
    page
      .getByTestId(TestId.MESSAGE_ITEM)
      .first()
      .element()
      .getBoundingClientRect().left
  ).toBe(header.getBoundingClientRect().left);
});

test('complete channel history shows a Paper welcome and date context for clock timestamps', async () => {
  await expect
    .element(page.getByTestId(TestId.MESSAGE_ITEM).first())
    .toBeVisible();
  await expect
    .element(page.getByText('Welcome to #general', { exact: true }))
    .toBeVisible();
  const welcome = page
    .getByText('Welcome to #general', { exact: true })
    .element();
  expect(getComputedStyle(welcome).fontSize).toBe('27px');
  expect(getComputedStyle(welcome).lineHeight).toBe('33px');
  const separator = document.querySelector('[data-message-date]')!;
  expect(separator.textContent).toBe('Today');
  expect(getComputedStyle(separator.querySelector('span')!).textTransform).toBe(
    'uppercase'
  );
  expect(separator.getBoundingClientRect().height).toBe(36);
  const author = messageAuthor('aria');
  const authorElement = author.element();
  const timestamp = authorElement.nextElementSibling!;
  expect(timestamp.textContent).toBe('9:40 AM');
  expect(timestamp.getAttribute('title')).toContain('2026');
  expect(timestamp.getAttribute('datetime')).toBe('2026-10-09T09:40:00.000Z');
});

test('composer has no resize handle or hint and grows naturally with multiline input', async () => {
  const composer = document.querySelector<HTMLElement>('.compose-container')!;
  const row = composer.querySelector<HTMLElement>('.compose-scroll-row')!;
  await expect
    .element(page.getByRole('separator', { name: 'Resize chat input' }))
    .not.toBeInTheDocument();
  expect(document.querySelector('.cursor-row-resize')).toBeNull();
  expect(composer.getBoundingClientRect().height).toBe(68);
  expect(getComputedStyle(composer).paddingTop).toBe('8px');
  expect(row.getBoundingClientRect().height).toBe(52);
  expect(getComputedStyle(row).backgroundColor).toBe('rgb(64, 66, 73)');
  expect(getComputedStyle(row).borderTopWidth).toBe('0px');
  expect(getComputedStyle(row).borderRadius).toBe('8px');
  const upload = page.getByRole('button', { name: 'Attach files' }).element();
  expect(upload.getBoundingClientRect().left).toBeLessThan(
    row.querySelector('.ProseMirror')!.getBoundingClientRect().left
  );
  await expect
    .element(
      page.getByText('Press Enter to send · Shift + Enter for a new line')
    )
    .not.toBeInTheDocument();
  expect(page.getByRole('button', { name: 'Send message' }).query()).toBeNull();
  const input = page.elementLocator(
    row.querySelector<HTMLElement>('.ProseMirror')!
  );
  const { getChannelDraftKey, getDraftMessage } =
    await import('@/components/channel-view/text/use-draft-messages');
  const draftKey = getChannelDraftKey(1);
  await input.click();
  await userEvent.type(input, 'A draft keeps an explicit send action.');
  await expect
    .element(page.getByRole('button', { name: 'Send message' }))
    .toBeVisible();
  await expect.poll(() => getDraftMessage(draftKey)).not.toBe('');
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
  await userEvent.type(
    input,
    'A second line grows the input without manual resize.'
  );
  await expect
    .poll(() => composer.getBoundingClientRect().height)
    .toBeGreaterThan(68);
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}'.repeat(40));
  await expect
    .poll(() => composer.getBoundingClientRect().height)
    .toBe(parseFloat(getComputedStyle(composer).maxHeight));
  expect(row.scrollHeight).toBeGreaterThan(row.clientHeight);
  expect(getComputedStyle(composer).resize).toBe('none');
  await userEvent.keyboard('{Control>}a{/Control}');
  await userEvent.keyboard('{Backspace}');
  await expect.poll(() => input.element().textContent).toBe('');
  await expect.poll(() => getDraftMessage(draftKey)).toBe('');
  await expect
    .poll(() => page.getByRole('button', { name: 'Send message' }).query())
    .toBeNull();
  await page.getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME).hover();
});

test('composer icon buttons have padded hit targets without clipping their icons', async () => {
  const { getChannelDraftKey, getDraftMessage } =
    await import('../components/channel-view/text/use-draft-messages');
  const assertPaddedIcon = (button: Element) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const icon = button.querySelector('svg')!.getBoundingClientRect();
    expect(rect.width).toBe(32);
    expect(rect.height).toBe(32);
    expect(parseFloat(style.paddingLeft)).toBeGreaterThanOrEqual(6);
    expect(parseFloat(style.paddingTop)).toBeGreaterThanOrEqual(6);
    expect(icon.left).toBeGreaterThanOrEqual(
      rect.left + parseFloat(style.paddingLeft)
    );
    expect(icon.top).toBeGreaterThanOrEqual(
      rect.top + parseFloat(style.paddingTop)
    );
    expect(icon.right).toBeLessThanOrEqual(
      rect.right - parseFloat(style.paddingRight)
    );
    expect(icon.bottom).toBeLessThanOrEqual(
      rect.bottom - parseFloat(style.paddingBottom)
    );
  };
  assertPaddedIcon(
    page.getByRole('button', { name: 'Attach files' }).element()
  );
  assertPaddedIcon(page.getByRole('button', { name: 'Add emoji' }).element());
  const input = page.elementLocator(
    document.querySelector<HTMLElement>('.compose-container .ProseMirror')!
  );
  await userEvent.type(input, 'Draft for testing send-button geometry.');
  await expect
    .element(page.getByRole('button', { name: 'Send message' }))
    .toBeVisible();
  assertPaddedIcon(
    page.getByRole('button', { name: 'Send message' }).element()
  );
  await userEvent.keyboard('{Control>}a{/Control}');
  await userEvent.keyboard('{Backspace}');
  await expect.poll(() => input.element().textContent).toBe('');
  await expect.poll(() => getDraftMessage(getChannelDraftKey(1))).toBe('');
  expect(page.getByRole('button', { name: 'Send message' }).query()).toBeNull();
});

test('the shared sidebar keeps the profile avatar without an application rail', async () => {
  expect(
    page.getByRole('navigation', { name: 'Application' }).elements()
  ).toHaveLength(0);
  expect(
    page
      .getByTestId(TestId.LEFT_SIDEBAR)
      .element()
      .querySelector('[data-slot="avatar"]')
  ).not.toBeNull();
});

test('the shared sidebar replaces the single-server application rail', async () => {
  expect(
    page.getByRole('navigation', { name: 'Application' }).elements()
  ).toHaveLength(0);
  await expect
    .element(page.getByRole('button', { name: 'Direct Channels' }))
    .toBeVisible();
  await expect
    .element(page.getByTestId(TestId.USER_SETTINGS_TRIGGER))
    .toBeVisible();
});

test('right docks open and close without layout animation', async () => {
  const assertInstantDock = async (panel: HTMLElement) => {
    await waitForRender();
    const openedWidth = panel.getBoundingClientRect().width;
    expect(openedWidth).toBeGreaterThan(0);
    expect(getComputedStyle(panel).transitionDuration).toBe('0s');
    expect(getComputedStyle(panel).animationDuration).toBe('0s');
    expect(panel.getAnimations()).toHaveLength(0);
    const handle = panel.querySelector<HTMLElement>('.cursor-col-resize')!;
    const right = panel.getBoundingClientRect().right;
    handle.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 })
    );
    await waitForRender();
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: right - openedWidth - 20 })
    );
    await waitForRender();
    expect(panel.getBoundingClientRect().width).toBe(openedWidth + 20);
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: right - openedWidth })
    );
    document.dispatchEvent(new MouseEvent('mouseup'));
    await waitForRender();
    expect(panel.getBoundingClientRect().width).toBe(openedWidth);
  };
  await page.getByRole('button', { name: 'Open Members Sidebar' }).click();
  const members = page
    .getByTestId(TestId.MEMBER_ITEM)
    .first()
    .element()
    .closest<HTMLElement>('.border-l')!;
  await assertInstantDock(members);
  await page.getByRole('button', { name: 'Close Members Sidebar' }).click();
  await waitForRender();
  expect(members.getBoundingClientRect().width).toBe(0);
  expect(members.getAnimations()).toHaveLength(0);

  const firstMessage = page.getByTestId(TestId.MESSAGE_ITEM).first();
  openThreadSidebar(Number(firstMessage.element().dataset.messageId), 1);
  await expect
    .element(page.getByRole('heading', { name: /^Thread in #/ }))
    .toBeVisible();
  const thread = page
    .getByRole('heading', { name: /^Thread in #/ })
    .element()
    .closest<HTMLElement>('.border-l')!;
  await assertInstantDock(thread);
  await expect
    .poll(() => thread.querySelector('.compose-container'))
    .not.toBeNull();
  expect(thread.querySelector('.cursor-row-resize')).toBeNull();
  expect(thread.textContent).not.toContain('Press Enter to send');
  closeThreadSidebar();
  await waitForRender();
  expect(thread.getBoundingClientRect().width).toBe(0);
  expect(thread.getAnimations()).toHaveLength(0);

  openVoiceChatSidebar(2);
  await waitForRender();
  const chat = Array.from(
    document.querySelectorAll<HTMLElement>('.border-l[style]')
  ).find((panel) => panel.getBoundingClientRect().width > 0)!;
  try {
    await assertInstantDock(chat);
    closeVoiceChatSidebar();
    await waitForRender();
    expect(chat.getBoundingClientRect().width).toBe(0);
    expect(chat.getAnimations()).toHaveLength(0);
  } finally {
    closeVoiceChatSidebar();
  }
});

test('text channel matches the Paper design', async () => {
  await expect.element(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
  await page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'general' })
    .click();

  await expect
    .element(page.getByRole('button', { name: 'Direct Channels' }))
    .toBeVisible();
  await snapshot('text-channel');
});

test('thread sidebar matches the Paper design', async () => {
  const firstMessage = page.getByTestId(TestId.MESSAGE_ITEM).first();
  await expect.element(firstMessage).toBeVisible();
  const messageId = Number(firstMessage.element().dataset.messageId);
  openThreadSidebar(messageId, 1);
  await expect
    .element(page.getByRole('heading', { name: /^Thread in #/ }))
    .toBeVisible();

  await snapshot('thread-sidebar');
  closeThreadSidebar();
});

test('members sidebar matches the Paper design', async () => {
  await page.getByRole('button', { name: 'Open Members Sidebar' }).click();
  await expect
    .element(page.getByTestId(TestId.MEMBER_ITEM).first())
    .toBeVisible();
  await expect.element(page.getByText(/^Online · \d+$/)).toBeVisible();
  await expect.element(page.getByText(/^Offline · \d+$/)).toBeVisible();
  await expect
    .element(page.getByRole('button', { name: 'Close Members Sidebar' }))
    .toBeVisible();

  await snapshot('members-sidebar');
});

test('direct messages match the Paper design', async () => {
  await page.getByRole('button', { name: 'Direct Channels' }).click();
  await page.getByTestId(TestId.DM_ITEM).filter({ hasText: 'aria' }).click();
  await expect
    .poll(() => document.querySelector('[data-dm-partner]')?.textContent)
    .toBe('aria');
  expect(document.querySelector('[data-dm-presence]')?.textContent).toMatch(
    /Online|Idle|Offline/
  );
  await expect
    .element(page.elementLocator(document.querySelector('[data-dm-welcome]')!))
    .toBeVisible();
  await expect
    .element(page.getByText('Message aria', { exact: true }))
    .toBeVisible();

  await snapshot('direct-messages');
  expect(document.querySelector('[data-channel-welcome]')).toBeNull();
});

test('voice controls hide on pointer exit and remain available to keyboard focus', async () => {
  setSelectedChannelId(2);
  addVoiceParticipants();
  await waitForRender();
  try {
    const stage = document.querySelector<HTMLElement>('.group\\/voice-stage')!;
    const controls = document.querySelector<HTMLElement>(
      '[data-voice-controls]'
    )!;
    await page.elementLocator(stage).hover();
    await waitForRender();
    await expect
      .poll(() => getComputedStyle(controls.parentElement!).opacity)
      .toBe('1');
    await page.getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME).hover();
    await waitForRender();
    await expect
      .poll(() => getComputedStyle(controls.parentElement!).opacity)
      .toBe('0');
    expect(getComputedStyle(controls).pointerEvents).toBe('none');

    const mute = page.getByRole('button', { name: 'Mute', exact: true });
    mute.element().focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitForRender();
    await expect
      .poll(() => getComputedStyle(controls.parentElement!).opacity)
      .toBe('1');
    mute.element().blur();
    await waitForRender();
    await expect
      .poll(() => getComputedStyle(controls.parentElement!).opacity)
      .toBe('0');
  } finally {
    removeVoiceParticipants();
    setSelectedChannelId(1);
  }
});

test('voice channel matches the Paper design', async () => {
  await markChannelAsRead(3, true);
  setSelectedChannelId(2);
  await joinVoice(2);

  setSelectedChannelId(1);
  await waitForRender();
  const lounge = page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'Lounge' })
    .first();
  const studio = page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'Studio' })
    .first();
  const loungeIcon = lounge.element().querySelector('svg')!;
  const studioIcon = studio.element().querySelector('svg')!;
  expect(getComputedStyle(loungeIcon).color).not.toBe(
    getComputedStyle(studioIcon).color
  );
  setSelectedChannelId(2);
  await waitForRender();

  addVoiceParticipants();
  await waitForRender();
  await revealVoiceControls();

  await expect
    .element(page.getByRole('button', { name: 'Mute' }))
    .toBeVisible();

  try {
    const reaction = page.getByRole('button', {
      name: 'Send a reaction',
      exact: true
    });
    await reaction.click();
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    const reactionButton = reaction.element();
    reactionButton.blur();
    await page.getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME).hover();
    const controls = document.querySelector<HTMLElement>(
      '[data-voice-controls]'
    );
    expect(controls).not.toBeNull();
    const callControls = Array.from(controls!.querySelectorAll('button'));
    expect(callControls).toHaveLength(6);
    const settingsButtons = callControls.filter((button) =>
      ['Microphone settings', 'Headphone settings'].includes(
        button.ariaLabel ?? ''
      )
    );
    expect(settingsButtons).toHaveLength(0);
    const caption = page.elementLocator(
      document.querySelector('.group\\/voice-user-card p')!
    );
    await expect.element(caption).toBeVisible();
    const stage = document.querySelector<HTMLElement>('.group\\/voice-stage')!;
    expect(stage.parentElement).not.toBeNull();
    const tile = caption.element().closest('.group\\/voice-user-card')!;
    const pin = page.elementLocator(
      tile.querySelector<HTMLButtonElement>('button[aria-pressed]')!
    );
    const pinLabel = pin.element().getAttribute('aria-label')!;
    const unpin = page.getByRole('button', {
      name: pinLabel.replace(/^Pin /, 'Unpin '),
      exact: true
    });
    await expect.element(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();
    await expect.element(unpin).toHaveAttribute('aria-pressed', 'true');
    await unpin.click();
    await expect
      .element(page.getByRole('button', { name: pinLabel, exact: true }))
      .toHaveAttribute('aria-pressed', 'false');
    const stats = page
      .getByRole('button', { name: 'Transport Statistics' })
      .element();
    const voiceDock = document.querySelector<HTMLElement>('[data-voice-dock]')!;
    expect(voiceDock.contains(stats)).toBe(true);
    await snapshot('voice-channel');
  } finally {
    await leaveVoice({ reason: 'user_disconnect_button' });
    setSelectedChannelId(1);

    removeVoiceParticipants();
  }
});

test('remote screen share stays in the real voice grid before watching', async () => {
  await markChannelAsRead(3, true);
  setSelectedChannelId(2);
  addVoiceParticipants(2);
  await waitForRender();
  try {
    await expect
      .element(
        page.getByRole('button', { name: "View aria's screen", exact: true })
      )
      .toBeVisible();
    const tile = document.querySelector<HTMLElement>(
      '[data-screen-share-card]'
    )!;
    expect(tile.querySelector('video')).toBeNull();
    expect(tile.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(tile.textContent).not.toContain('LIVE');
    expect(tile.textContent).toContain("aria's screen");
    const participant = document.querySelector<HTMLElement>(
      '.group\\/voice-user-card'
    )!;
    expect(tile.getBoundingClientRect().width).toBe(
      participant.getBoundingClientRect().width
    );
    expect(tile.getBoundingClientRect().height).toBe(
      participant.getBoundingClientRect().height
    );
    expect(
      tile.getBoundingClientRect().width / tile.getBoundingClientRect().height
    ).toBeCloseTo(16 / 9, 2);
    try {
      for (const [width, height] of [
        [1024, 600],
        [2560, 1440]
      ]) {
        await page.viewport(width, height);
        await waitForRender();
        const rect = tile.getBoundingClientRect();
        const button = tile.querySelector('button')!.getBoundingClientRect();
        expect(rect.width / rect.height).toBeCloseTo(16 / 9, 2);
        expect(button.left).toBeGreaterThanOrEqual(rect.left);
        expect(button.right).toBeLessThanOrEqual(rect.right);
        expect(rect.bottom).toBeLessThanOrEqual(height);
      }
    } finally {
      await page.viewport(1440, 900);
      await waitForRender();
    }
    await page.getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME).hover();
    await snapshot('screen-sharing-not-watching');
  } finally {
    removeVoiceParticipants();
    setSelectedChannelId(1);
  }
});

test('screen sharing states match the Paper design', async () => {
  const stream = createScreenShareStream();
  const mediaDevices = navigator.mediaDevices;
  const originalGetDisplayMedia = Object.getOwnPropertyDescriptor(
    mediaDevices,
    'getDisplayMedia'
  );
  Object.defineProperty(mediaDevices, 'getDisplayMedia', {
    configurable: true,
    value: vi.fn().mockResolvedValue(stream)
  });

  const { promise: releaseStateUpdate, resolve: resolveStateUpdate } =
    Promise.withResolvers<void>();
  const stateUpdates: Promise<void>[] = [];
  const getClientSpy = vi.mocked(trpc.getTRPCClient).mockReturnValue({
    voice: {
      updateState: {
        mutate: () => {
          stateUpdates.push(releaseStateUpdate);
          return releaseStateUpdate;
        }
      }
    }
  } as unknown as ReturnType<typeof trpc.getTRPCClient>);

  setSelectedChannelId(2);
  setCurrentVoiceChannelId(2);
  updateOwnVoiceState({ sharingScreen: false });
  addVoiceParticipants(1);
  await waitForRender();
  await revealVoiceControls();
  await expect
    .element(page.getByRole('button', { name: 'Mute' }))
    .toBeVisible();

  try {
    await page.getByRole('button', { name: 'Share Screen' }).click();

    for (let attempt = 0; attempt < 10; attempt++) {
      if (document.querySelector('video')) break;
      await waitForRender();
    }
    expect(document.querySelector('video')).not.toBeNull();

    await snapshot('screen-sharing-grid');

    setPinnedCard({
      id: 'screen-share-1',
      type: PinnedCardType.SCREEN_SHARE,
      userId: 1
    });
    await waitForRender();
    await revealVoiceControls();
    await snapshot('screen-sharing-focus');
  } finally {
    await page
      .getByRole('button', { name: 'Stop screen share', exact: true })
      .click();
    resolveStateUpdate();
    await Promise.all(stateUpdates);
    await waitForRender();

    for (let attempt = 0; attempt < 10; attempt++) {
      await waitForRender();
      if (!document.querySelector('video')) break;
    }

    setPinnedCard(undefined);
    updateOwnVoiceState({ sharingScreen: false });
    setCurrentVoiceChannelId(undefined);
    setSelectedChannelId(1);
    removeVoiceParticipants();
    stream.getTracks().forEach((track) => track.stop());
    getClientSpy.mockRestore();

    if (originalGetDisplayMedia) {
      Object.defineProperty(
        mediaDevices,
        'getDisplayMedia',
        originalGetDisplayMedia
      );
    } else {
      Reflect.deleteProperty(mediaDevices, 'getDisplayMedia');
    }
    toast.dismiss();
    clearVoiceDebugEvents();
    for (let attempt = 0; attempt < 20; attempt++) {
      await waitForRender();
      if (!document.querySelector('[data-sonner-toast]')) break;
    }
  }
});

test('user settings match the Paper design', async () => {
  openServerScreen(ServerScreen.USER_SETTINGS);
  await expect
    .element(page.getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY).first())
    .toBeVisible();

  await userEvent.unhover(document.body);
  await snapshot('user-settings');
});

test('profile settings edit a live preview that matches the user popover', async () => {
  const [{ store }, { ownUserSelector }, { updateUser }] = await Promise.all([
    import('@/features/store'),
    import('@/features/server/users/selectors'),
    import('@/features/server/users/actions')
  ]);
  const ownUser = ownUserSelector(store.getState());
  if (!ownUser) throw new Error('Own user is missing');

  const originalBanner = ownUser.banner;
  const previewBanner: TFile = {
    id: -1,
    name: 'profile-preview-banner.png',
    originalName: 'profile-preview-banner.png',
    md5: '',
    userId: ownUser.id,
    pluginId: null,
    size: 0,
    mimeType: 'image/png',
    extension: 'png',
    createdAt: Date.UTC(2026, 9, 9),
    updatedAt: null
  };
  updateUser(ownUser.id, { banner: null });

  try {
    openServerScreen(ServerScreen.USER_SETTINGS);
    const preview = page.getByRole('group', {
      name: 'Profile',
      exact: true
    });
    await expect.element(preview).toBeVisible();

    const previewElement = preview.element();
    const banner = previewElement.querySelector('[data-profile-banner]')!;
    const avatar = previewElement.querySelector('[data-profile-avatar]')!;
    const previewBounds = previewElement.getBoundingClientRect();
    const bannerBounds = banner.getBoundingClientRect();
    const avatarBounds = avatar.getBoundingClientRect();
    expect(previewBounds.width).toBe(320);
    expect(bannerBounds.height).toBe(128);
    const previewAvatarOffset = avatarBounds.top - bannerBounds.top;
    expect(avatarBounds.height).toBe(120);
    await expect.element(preview.getByText(/^Member since/)).toBeVisible();
    await expect
      .element(
        page.getByText('How you appear in this server.', { exact: true })
      )
      .not.toBeInTheDocument();

    const avatarButton = preview.getByRole('button', {
      name: 'Change avatar',
      exact: true
    });
    await userEvent.hover(avatarButton);
    await snapshot('profile-preview-avatar-hover');
    await userEvent.unhover(avatarButton);

    const bannerButton = preview.getByRole('button', {
      name: 'Change banner',
      exact: true
    });
    const bannerAffordances = banner.querySelectorAll(
      ':scope > span[aria-hidden="true"]'
    );
    const bannerOverlay = bannerAffordances[0]!;
    const bannerPaintBrush = bannerAffordances[1]!;

    await bannerButton.click();
    const menu = page.getByRole('menu');
    await expect.element(menu).toBeVisible();
    const changeColorMenuItem = menu.getByRole('menuitem', {
      name: 'Change profile color',
      exact: true
    });
    const overlayStyle = getComputedStyle(bannerOverlay);
    const paintBrushStyle = getComputedStyle(bannerPaintBrush);
    expect(overlayStyle.backgroundColor).toBe('oklab(0 0 0 / 0.25)');
    expect(paintBrushStyle.opacity).toBe('1');
    await snapshot('profile-preview-banner-menu');
    updateUser(ownUser.id, { banner: previewBanner });
    await expect
      .element(
        menu.getByRole('menuitem', { name: 'Change banner', exact: true })
      )
      .toBeVisible();
    await expect
      .element(
        menu.getByRole('menuitem', {
          name: 'Change profile color',
          exact: true
        })
      )
      .toBeVisible();
    await expect
      .element(
        menu.getByRole('menuitem', { name: 'Remove banner', exact: true })
      )
      .toBeVisible();

    await changeColorMenuItem.click();
    await expect
      .element(page.getByText('Profile color', { exact: true }))
      .toBeVisible();
    const profileColorInput = page.getByRole('textbox', {
      name: 'Profile color',
      exact: true
    });
    await profileColorInput.fill('#abcdef');
    const bannerStyle = getComputedStyle(banner);
    expect(bannerStyle.backgroundColor).toBe('rgb(171, 205, 239)');

    const bannerButtonElement = bannerButton.element();
    bannerButtonElement.focus();
    await userEvent.keyboard('{Enter}');
    const removeBannerMenuItem = page.getByRole('menuitem', {
      name: 'Remove banner',
      exact: true
    });
    await removeBannerMenuItem.click();
    const previewBannerImage = banner.querySelector('img');
    expect(previewBannerImage).toBeNull();

    const nameButton = preview.getByRole('button', { name: /Edit name/ });
    await nameButton.click();
    const nameDialog = page.getByRole('alertdialog');
    const nameInput = nameDialog.getByRole('textbox');
    await nameInput.fill('Preview name');
    const saveNameButton = nameDialog.getByRole('button', {
      name: 'Save Changes',
      exact: true
    });
    await saveNameButton.click();
    await expect
      .element(nameButton)
      .toHaveAccessibleName('Preview name Edit name');

    // the bio is a plain field in the preview, it saves itself
    const bioInput = preview.getByRole('textbox', { name: 'Bio' });
    await bioInput.fill('A live preview');
    await expect.element(bioInput).toHaveValue('A live preview');

    closeServerScreens();
    updateUser(ownUser.id, { banner: originalBanner });
    await waitForRender();
    const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
    const ownUserName = sidebar.getByText('rnd332', { exact: true });
    await ownUserName.click();
    const popover = page.getByRole('dialog');
    await expect.element(popover).toBeVisible();
    const popoverElement = popover.element();
    const popoverBanner = popoverElement.querySelector(
      '[data-profile-banner]'
    )!;
    const popoverAvatar = popoverElement.querySelector(
      '[data-profile-avatar]'
    )!;
    const popoverBounds = popoverElement.getBoundingClientRect();
    const popoverBannerBounds = popoverBanner.getBoundingClientRect();
    const popoverAvatarBounds = popoverAvatar.getBoundingClientRect();
    expect(popoverBounds.width).toBe(320);
    expect(popoverBannerBounds.height).toBe(128);
    expect(popoverAvatarBounds.width).toBe(120);
    expect(popoverAvatarBounds.height).toBe(120);
    const popoverAvatarOffset =
      popoverAvatarBounds.top - popoverBannerBounds.top;
    expect(
      Math.abs(previewAvatarOffset - popoverAvatarOffset)
    ).toBeLessThanOrEqual(1);
    const initials = popover.getByText('R', { exact: true });
    const initialsElement = initials.element();
    const initialsStyle = getComputedStyle(initialsElement);
    expect(initialsStyle.fontSize).toBe('36px');
    expect(initialsStyle.fontWeight).toBe('700');
    await expect(popover).toMatchScreenshot('user-popover-profile-preview', {
      timeout: 3_000
    });
    await userEvent.keyboard('{Escape}');
  } finally {
    closeServerScreens();
    resetDialogs();
    updateUser(ownUser.id, { banner: originalBanner });
  }
});

test('clicking the banner body opens the banner menu', async () => {
  try {
    await userEvent.unhover(document.body);
    openServerScreen(ServerScreen.USER_SETTINGS);
    const preview = page.getByRole('group', {
      name: 'Profile',
      exact: true
    });
    await expect.element(preview).toBeVisible();
    const previewElement = preview.element();
    const banner = previewElement.querySelector('[data-profile-banner]')!;
    await userEvent.click(banner);
    await expect.element(page.getByRole('menu')).toBeVisible();
  } finally {
    closeServerScreens();
    resetDialogs();
  }
});

test('Escape closes the banner menu without closing User settings', async () => {
  try {
    await userEvent.unhover(document.body);
    openServerScreen(ServerScreen.USER_SETTINGS);
    const preview = page.getByRole('group', {
      name: 'Profile',
      exact: true
    });
    await expect.element(preview).toBeVisible();
    const bannerButton = preview.getByRole('button', {
      name: 'Change banner',
      exact: true
    });
    const bannerButtonElement = bannerButton.element();
    bannerButtonElement.focus();
    await userEvent.keyboard('{Enter}');

    const menu = page.getByRole('menu');
    await expect.element(menu).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(menu).not.toBeInTheDocument();
    await expect.element(preview).toBeVisible();
  } finally {
    closeServerScreens();
    resetDialogs();
  }
});
test('saved profile edits stay synchronized with the user popover', async () => {
  const [{ store }, { ownUserSelector }, { updateUser }] = await Promise.all([
    import('@/features/store'),
    import('@/features/server/users/selectors'),
    import('@/features/server/users/actions')
  ]);
  const ownUser = ownUserSelector(store.getState());
  if (!ownUser) throw new Error('Own user is missing');

  const client = trpc.getTRPCClient();
  let shouldRestoreProfile = false;

  try {
    openServerScreen(ServerScreen.USER_SETTINGS);
    const preview = page.getByRole('group', {
      name: 'Profile',
      exact: true
    });
    await expect.element(preview).toBeVisible();

    const nameButton = preview.getByRole('button', { name: /Edit name/ });
    await nameButton.click();
    const nameDialog = page.getByRole('alertdialog');
    const nameInput = nameDialog.getByRole('textbox');
    await nameInput.fill('Profile sync test');
    const saveNameButton = nameDialog.getByRole('button', {
      name: 'Save Changes',
      exact: true
    });
    await saveNameButton.click();

    // the bio is a plain field in the preview, it saves itself
    const bioInput = preview.getByRole('textbox', { name: 'Bio' });
    await bioInput.fill('Profile sync bio');

    const bannerButton = preview.getByRole('button', {
      name: 'Change banner',
      exact: true
    });
    await bannerButton.click();
    const changeColorMenuItem = page.getByRole('menuitem', {
      name: 'Change profile color',
      exact: true
    });
    await changeColorMenuItem.click();
    const profileColorInput = page.getByRole('textbox', {
      name: 'Profile color',
      exact: true
    });
    await profileColorInput.fill('#123abc');

    shouldRestoreProfile = true;
    const saveProfileButton = page.getByRole('button', {
      name: 'Save Changes',
      exact: true
    });
    await saveProfileButton.click();
    await expect
      .poll(() => ownUserSelector(store.getState())?.name)
      .toBe('Profile sync test');
    await expect
      .poll(() => ownUserSelector(store.getState())?.bio)
      .toBe('Profile sync bio');
    await expect
      .poll(() => ownUserSelector(store.getState())?.profileColor)
      .toBe('#123abc');

    closeServerScreens();
    await waitForRender();
    const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
    const ownUserName = sidebar.getByText('Profile sync test', {
      exact: true
    });
    await ownUserName.click();
    const popover = page.getByRole('dialog');
    await expect.element(popover).toBeVisible();
    await expect
      .element(popover.getByText('Profile sync test', { exact: true }))
      .toBeVisible();
    await expect
      .element(popover.getByText('Profile sync bio', { exact: true }))
      .toBeVisible();
    const popoverElement = popover.element();
    const popoverBanner = popoverElement.querySelector(
      '[data-profile-banner]'
    )!;
    const popoverBannerStyle = getComputedStyle(popoverBanner);
    expect(popoverBannerStyle.backgroundColor).toBe('rgb(18, 58, 188)');
    await userEvent.keyboard('{Escape}');
  } finally {
    closeServerScreens();
    resetDialogs();
    if (shouldRestoreProfile) {
      await client.users.update.mutate({
        name: ownUser.name,
        profileColor: ownUser.profileColor,
        bio: ownUser.bio ?? undefined
      });
    }

    updateUser(ownUser.id, {
      name: ownUser.name,
      profileColor: ownUser.profileColor,
      bio: ownUser.bio
    });
  }
});

test('personal theme preview applies to settings, chat and body portals', async () => {
  openServerScreen(ServerScreen.USER_SETTINGS);
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Appearance & language' })
    .click();
  await page
    .getByRole('button', { name: 'Preview Ryūko', exact: true })
    .click();
  expect(document.documentElement.dataset.theme).not.toBe('ryuko');
  const portal = document.createElement('div');
  try {
    await page
      .getByRole('button', { name: 'Apply theme', exact: true })
      .click();
    await expect
      .poll(() => document.documentElement.dataset.theme)
      .toBe('ryuko');
    expect(localStorage.getItem('vite-ui-theme')).toBe('ryuko');
    const settings = document.querySelector('main')!;
    expect(getComputedStyle(settings).backgroundColor).toBe('rgb(20, 24, 37)');
    closeServerScreens();
    await expect.element(page.getByTestId(TestId.SERVER_VIEW)).toBeVisible();
    expect(
      getComputedStyle(page.getByTestId(TestId.SERVER_VIEW).element())
        .backgroundColor
    ).toBe('rgb(20, 24, 37)');
    await expect(
      page.elementLocator(document.documentElement)
    ).toMatchScreenshot('theme-ryuko-chat', { timeout: 3_000 });
    portal.className = 'bg-popover text-popover-foreground';
    document.body.append(portal);
    expect(getComputedStyle(portal).backgroundColor).toBe('rgb(12, 16, 27)');
  } finally {
    portal.remove();
    openServerScreen(ServerScreen.USER_SETTINGS);
    await page
      .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
      .filter({ hasText: 'Appearance & language' })
      .click();
    await page
      .getByRole('button', { name: 'Preview Dodecagon Dark', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Apply theme', exact: true })
      .click();
    await expect
      .poll(() => document.documentElement.dataset.theme)
      .toBe('dark');
  }
});

test('theme confirmation floats above settings without moving the catalog', async () => {
  openServerScreen(ServerScreen.USER_SETTINGS);
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Appearance & language' })
    .click();
  const search = page.getByRole('textbox', { name: 'Search themes' });
  await search.fill('Miku');
  const catalog = page.getByRole('region', { name: 'Themes', exact: true });
  const before = catalog.element().getBoundingClientRect();
  await page
    .getByRole('button', { name: 'Preview Hatsune Miku', exact: true })
    .click();
  const after = catalog.element().getBoundingClientRect();
  expect(after.y).toBe(before.y);
  expect(after.height).toBe(before.height);
  const apply = page.getByRole('button', { name: 'Apply theme', exact: true });
  const confirmation = apply.element().parentElement!.parentElement!;
  expect(getComputedStyle(confirmation).position).toBe('fixed');
  expect(confirmation.parentElement).toBe(document.body);
  await expect(page.elementLocator(confirmation)).toMatchScreenshot(
    'theme-preview-toast',
    { timeout: 3_000 }
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(catalog.element().getBoundingClientRect().y).toBe(before.y);
});

test('theme catalog is one searchable list containing every theme', async () => {
  openServerScreen(ServerScreen.USER_SETTINGS);
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Appearance & language' })
    .click();
  const catalog = page.getByRole('region', { name: 'Themes', exact: true });
  const search = page.getByRole('textbox', { name: 'Search themes' });
  await expect.element(search).toBeVisible();
  expect(
    catalog.element().querySelectorAll('button[aria-pressed]')
  ).toHaveLength(106);
  expect(catalog.element().querySelectorAll('h4')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('Made for you');
  expect(document.querySelector('[aria-label="Theme brightness"]')).toBeNull();
  await search.fill('Miku');
  expect(
    catalog.element().querySelectorAll('button[aria-pressed]')
  ).toHaveLength(1);
  await expect
    .element(
      page.getByRole('button', { name: 'Preview Hatsune Miku', exact: true })
    )
    .toBeVisible();
  await search.fill('ryuko');
  await expect
    .element(page.getByRole('button', { name: 'Preview Ryūko', exact: true }))
    .toBeVisible();
  await search.fill('Tokyo');
  expect(
    catalog.element().querySelectorAll('button[aria-pressed]')
  ).toHaveLength(2);
  await page
    .getByRole('button', { name: 'Preview Dark Tokyo Night', exact: true })
    .click();
  expect(document.documentElement.dataset.theme).toBe('dark');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(document.documentElement.dataset.theme).toBe('dark');
  await search.fill('no-such-theme');
  await expect.element(page.getByText('No themes found.')).toBeVisible();
  await search.fill('');
  expect(
    catalog.element().querySelectorAll('button[aria-pressed]')
  ).toHaveLength(106);
});

test('Miku uses its pink rail accent and light mode reaches settings and dialogs', async () => {
  await markChannelAsRead(3, true);
  openServerScreen(ServerScreen.USER_SETTINGS);
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Appearance & language' })
    .click();
  await page
    .getByRole('button', { name: 'Preview Hatsune Miku', exact: true })
    .click();
  await page.getByRole('button', { name: 'Apply theme', exact: true }).click();
  closeServerScreens();
  const sidebar = page.getByTestId(TestId.LEFT_SIDEBAR);
  try {
    await expect.element(sidebar).toBeVisible();
    expect(getComputedStyle(sidebar.element()).backgroundColor).toBe(
      'rgb(21, 28, 34)'
    );
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim()
    ).toBe('#39c5cf');
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim()
    ).toBe('#163d43');
    expect(
      getComputedStyle(document.querySelector('.compose-scroll-row')!)
        .backgroundColor
    ).toBe('rgb(40, 47, 54)');
    await expect(
      page.elementLocator(document.documentElement)
    ).toMatchScreenshot('theme-miku-chat', { timeout: 3_000 });
    openServerScreen(ServerScreen.USER_SETTINGS);
    await page
      .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
      .filter({ hasText: 'Appearance & language' })
      .click();
    await page
      .getByRole('button', { name: 'Preview Dodecagon Light', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Apply theme', exact: true })
      .click();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(
      getComputedStyle(document.querySelector('main')!).backgroundColor
    ).toBe('oklch(1 0 0)');
    const result = requestConfirmation({
      title: 'Light dialog fixture',
      confirmLabel: 'Confirm light fixture'
    });
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog).toBeVisible();
    expect(
      getComputedStyle(dialog.element()).getPropertyValue('--canvas').trim()
    ).toBe('#ffffff');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await result;
  } finally {
    resetDialogs();
    openServerScreen(ServerScreen.USER_SETTINGS);
    await page
      .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
      .filter({ hasText: 'Appearance & language' })
      .click();
    await page
      .getByRole('button', { name: 'Preview Dodecagon Dark', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Apply theme', exact: true })
      .click();
    await expect
      .poll(() => document.documentElement.dataset.theme)
      .toBe('dark');
  }
});

test('theme settings keep the approved layout and remain usable on a narrow viewport', async () => {
  openServerScreen(ServerScreen.USER_SETTINGS);
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Appearance & language' })
    .click();
  await expect
    .element(page.getByRole('button', { name: 'Preview Ryūko', exact: true }))
    .toBeVisible();
  await userEvent.unhover(document.body);
  await expect(page.elementLocator(document.documentElement)).toMatchScreenshot(
    'theme-settings',
    { timeout: 3_000 }
  );
  try {
    await page.viewport(390, 844);
    await page
      .getByRole('button', { name: 'Preview Hatsune Miku', exact: true })
      .click();
    const apply = page.getByRole('button', {
      name: 'Apply theme',
      exact: true
    });
    await expect.element(apply).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(apply.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      390
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search themes' })
      .fill('light github');
    const card = page.getByRole('button', {
      name: 'Preview Light Github',
      exact: true
    });
    await expect.element(card).toBeVisible();
    card.element().focus();
    await userEvent.keyboard('{Enter}');
    await expect
      .element(page.getByRole('button', { name: 'Apply theme', exact: true }))
      .toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await page.viewport(1440, 900);
    await waitForRender();
    await userEvent.unhover(document.body);
  }
});

test('server settings match the Paper design', async () => {
  openServerScreen(ServerScreen.SERVER_SETTINGS);
  await expect
    .element(page.getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY).first())
    .toBeVisible();

  await snapshot('server-settings');
});

test('channel settings match the Paper design', async () => {
  openServerScreen(ServerScreen.CHANNEL_SETTINGS, { channelId: 1 });
  await expect
    .element(page.getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY).first())
    .toBeVisible();

  await snapshot('channel-settings');
});

test('category settings match the Paper design', async () => {
  openServerScreen(ServerScreen.CATEGORY_SETTINGS, { categoryId: 1 });
  await expect
    .element(page.getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY).first())
    .toBeVisible();

  await snapshot('category-settings');
});

test('plugin marketplace matches the Paper design', async () => {
  openServerScreen(ServerScreen.SERVER_SETTINGS);
  // the updates panel renders a tall placeholder while it loads, so the page
  // height only settles once the release check came back
  await expect
    .element(
      page.getByText('Check the version running on this server.', {
        exact: true
      })
    )
    .toBeVisible();
  await page
    .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
    .filter({ hasText: 'Plugins' })
    .click();
  await page.getByRole('tab', { name: 'Marketplace' }).click();
  await expect
    .element(page.getByText('Soundboard', { exact: true }))
    .toBeVisible();

  await snapshot('plugin-marketplace');
});

test('search dialog matches the Paper design', async () => {
  openDialog(Dialog.SEARCH);
  await expect.element(page.getByTestId(TestId.SEARCH_INPUT)).toBeVisible();

  await snapshot('search-dialog');
});

test('create channel uses the Paper sheet geometry and selectable options', async () => {
  openDialog(Dialog.CREATE_CHANNEL);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const dialog = page.getByRole('dialog').element();
  expect(dialog.getBoundingClientRect().height).toBeLessThan(500);
  expect(dialog.getBoundingClientRect().width).toBe(410);
  await expect
    .element(page.getByText('Give your community a place to talk.'))
    .toBeVisible();
  const text = page.getByRole('radio', { name: 'Text channel' });
  const voice = page.getByRole('radio', { name: 'Voice channel' });
  expect(text.element().getAttribute('aria-checked')).toBe('true');
  expect(text.element().getBoundingClientRect().height).toBe(50);
  expect(getComputedStyle(text.element()).paddingLeft).toBe('15px');
  expect(getComputedStyle(text.element()).borderTopWidth).toBe('1px');
  await voice.click();
  expect(voice.element().getAttribute('aria-checked')).toBe('true');
  expect(text.element().getAttribute('aria-checked')).toBe('false');
  const footer = dialog.querySelector('[data-slot="dialog-footer"]')!;
  expect(footer.getBoundingClientRect().height).toBe(72);
  expect(footer.getBoundingClientRect().bottom).toBeCloseTo(
    dialog.getBoundingClientRect().bottom - 1,
    0
  );
  expect(dialog.querySelector('input')!.getBoundingClientRect().height).toBe(
    44
  );
  expect(
    dialog.querySelectorAll('[data-slot="dialog-footer"] button')
  ).toHaveLength(1);
});

test('create channel type choices are keyboard operable', async () => {
  openDialog(Dialog.CREATE_CHANNEL);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const text = page.getByRole('radio', { name: 'Text channel' });
  const voice = page.getByRole('radio', { name: 'Voice channel' });

  // the group keeps a single tab stop on the selected option
  expect(text.element().getAttribute('tabindex')).toBe('0');
  expect(voice.element().getAttribute('tabindex')).toBe('-1');

  await text.click();
  await expect.element(text).toHaveFocus();

  await userEvent.keyboard('{ArrowDown}');
  await expect.element(voice).toHaveFocus();
  await expect.element(voice).toHaveAttribute('aria-checked', 'true');
  await expect.element(text).toHaveAttribute('aria-checked', 'false');

  await userEvent.keyboard('{ArrowDown}');
  await expect.element(text).toHaveFocus();
  await expect.element(text).toHaveAttribute('aria-checked', 'true');

  await userEvent.keyboard('{ArrowUp}');
  await expect.element(voice).toHaveFocus();
  await expect.element(voice).toHaveAttribute('aria-checked', 'true');

  await userEvent.keyboard('{End}');
  await expect.element(voice).toHaveFocus();

  await userEvent.keyboard('{Home}');
  await expect.element(text).toHaveFocus();
  await expect.element(text).toHaveAttribute('aria-checked', 'true');

  // the next snapshots expect no focused element and the pointer away from the
  // dialogs, so both are restored before the test ends
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  (document.activeElement as HTMLElement | null)?.blur();
  await page.getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME).hover();
});

test('create channel dialog matches the Paper design', async () => {
  openDialog(Dialog.CREATE_CHANNEL);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(
    getComputedStyle(page.getByRole('dialog').element()).borderRadius
  ).toBe('12px');

  await snapshot('create-channel-dialog');
});

test('create category dialog matches the Paper design', async () => {
  openDialog(Dialog.CREATE_CATEGORY);
  await expect.element(page.getByRole('dialog')).toBeVisible();

  await snapshot('create-category-dialog');
});

test('create invite dialog matches the Paper design', async () => {
  openDialog(Dialog.CREATE_INVITE, { refetch: () => undefined });
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox').first().fill('rnd-community-invite');

  await snapshot('create-invite-dialog');
});

test('profile setup dialog matches the Paper design', async () => {
  openDialog(Dialog.WELCOME_PROFILE_SETUP);
  await expect.element(page.getByRole('dialog')).toBeVisible();

  // The previous dialog's input can leave the pointer over the upload cover.
  await page
    .getByTestId(TestId.LEFT_SIDEBAR_SERVER_NAME)
    .hover({ force: true });
  await snapshot('profile-setup-dialog');
});

test('voice diagnostics dialog matches the Paper design', async () => {
  clearVoiceDebugEvents();
  openDialog(Dialog.VOICE_DEBUG);
  await expect.element(page.getByRole('dialog')).toBeVisible();

  await expect(page).toMatchScreenshot('voice-diagnostics-dialog', {
    comparatorOptions: { allowedMismatchedPixelRatio: 0.0002 },
    timeout: 3_000
  });
});

test.each([
  [
    'rename',
    Dialog.TEXT_INPUT,
    {
      title: 'Rename fixture',
      message: 'Rename only; no data is submitted.',
      type: 'text'
    },
    'alertdialog'
  ],
  [
    'password',
    Dialog.SERVER_PASSWORD,
    { handshakeHash: 'visual-fixture-handshake' },
    'alertdialog'
  ],
  ['media sounds', Dialog.SOUNDS, {}, 'dialog'],
  ['role access', Dialog.ASSIGN_ROLE, {}, 'alertdialog']
] as const)(
  '%s uses the shared compact dialog skin',
  async (_name, kind, props, role) => {
    const { store } = await import('@/features/store');
    const { userByIdSelector } =
      await import('@/features/server/users/selectors');
    const state = store.getState();
    const user = userByIdSelector(state, 2)!;
    openDialog(kind, { user, refetch: async () => undefined, ...props });
    const locator = page.getByRole(role);
    try {
      await expect.element(locator).toBeVisible();
      const element = locator.element();
      const style = getComputedStyle(element);
      expect(style.backgroundColor).toBe('rgb(49, 51, 56)');
      expect(style.borderRadius).toBe('12px');
      expect(element.getBoundingClientRect().width).toBe(410);
      expect(element.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
      expect(element.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        innerHeight
      );
    } finally {
      resetDialogs();
      await waitForRender();
    }
  }
);

test('plugin detail loads through the existing installed fixture and real server', async () => {
  const client = trpc.getTRPCClient();
  const initial = await client.plugins.get.query();
  const fixture = initial.plugins.find((plugin) => plugin.id === 'e2e-plugin')!;
  expect(fixture.enabled).toBe(false);
  const wasEnabled = fixture.enabled;
  try {
    await client.plugins.toggle.mutate({
      pluginId: 'e2e-plugin',
      enabled: true
    });
    openServerScreen(ServerScreen.SERVER_SETTINGS);
    const entry = page
      .getByTestId(TestId.SETTINGS_SIDEBAR_ENTRY)
      .filter({ hasText: 'E2E Plugin' });
    await expect.element(entry).toBeVisible();
    await entry.click();
    await expect
      .element(
        page.getByRole('heading', { name: 'E2E Plugin', exact: true, level: 2 })
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('tab', { name: 'Commands', exact: true }))
      .toBeVisible();
    await page.getByRole('tab', { name: 'Logs', exact: true }).click();
    await expect
      .element(page.getByRole('tabpanel', { name: 'Logs' }))
      .toBeVisible();
  } finally {
    closeServerScreens();
    await client.plugins.toggle.mutate({
      pluginId: 'e2e-plugin',
      enabled: wasEnabled
    });
    const restored = await client.plugins.get.query();
    const current = restored.plugins.find(
      (plugin) => plugin.id === fixture.id
    )!;
    expect(current.enabled).toBe(wasEnabled);
    await expect
      .element(page.getByTestId('e2e-plugin-topbar'))
      .not.toBeInTheDocument();
  }
});

test('search results show real fixture matches with the shared surface hierarchy', async () => {
  openDialog(Dialog.SEARCH);
  const dialog = page.getByRole('dialog');
  try {
    await page.getByTestId(TestId.SEARCH_INPUT).fill('voice controls');
    await expect
      .element(
        dialog.getByText(
          'The new direction feels much calmer. I left one note on the voice controls.',
          { exact: true }
        )
      )
      .toBeVisible();
    await expect
      .element(dialog.getByTestId(TestId.SEARCH_RESULT_JUMP).first())
      .toBeEnabled();
    const element = dialog.element();
    expect(getComputedStyle(element).backgroundColor).toBe('rgb(49, 51, 56)');
    expect(getComputedStyle(element).borderRadius).toBe('12px');
  } finally {
    resetDialogs();
    await waitForRender();
  }
});

test('connection retry uses the approved surface and readable progress states', async () => {
  const { store } = await import('@/features/store');
  const { serverSliceActions } = await import('@/features/server/slice');
  try {
    for (const nextAttemptAt of [Date.now() + 5_000, null]) {
      store.dispatch(
        serverSliceActions.setReconnect({
          attempt: 2,
          nextAttemptAt
        })
      );
      const overlay = page.getByRole('dialog', { name: 'Connection lost' });
      await expect.element(overlay).toBeVisible();
      await expect
        .element(page.getByText('Connection lost', { exact: true }))
        .toBeVisible();
      await expect
        .element(
          page.getByRole('button', {
            name: 'Sign out and stop reconnecting',
            exact: true
          })
        )
        .toBeEnabled();
      const element = overlay.element();
      expect(getComputedStyle(element).backgroundColor).toBe('rgb(49, 51, 56)');
      const icon = element.querySelector('svg')!;
      expect(getComputedStyle(icon).color).toBe('rgb(174, 181, 255)');
      await waitForRender();
    }
  } finally {
    store.dispatch(serverSliceActions.setReconnect(null));
  }
});

test('same-author messages across midnight retain both date separators', async () => {
  const client = trpc.getTRPCClient();
  const original = await client.messages.get.query({
    channelId: 1,
    limit: 50,
    cursor: null
  });
  const template = original.messages[0];
  try {
    await writeMessageWindow(
      store,
      1,
      [
        {
          ...template,
          id: 900001,
          content: 'Before midnight',
          createdAt: Date.UTC(2026, 9, 8, 23, 59, 50)
        },
        {
          ...template,
          id: 900002,
          content: 'After midnight',
          createdAt: Date.UTC(2026, 9, 9, 0, 0, 10)
        }
      ],
      false
    );
    await expect
      .element(page.getByText('After midnight', { exact: true }))
      .toBeVisible();
    expect(
      Array.from(
        document.querySelectorAll('[data-message-date]'),
        (el) => el.textContent
      )
    ).toEqual(['October 8th, 2026', 'Today']);
    expect(
      Array.from(
        document.querySelectorAll('[data-messages-container] time'),
        (el) => el.getAttribute('datetime')
      )
    ).toEqual(['2026-10-08T23:59:50.000Z', '2026-10-09T00:00:10.000Z']);
    await writeMessageWindow(store, 1, [...original.messages].reverse(), true);
    await waitForRender();
    expect(document.querySelector('[data-channel-welcome]')).toBeNull();
  } finally {
    await writeMessageWindow(store, 1, [...original.messages].reverse(), false);
  }
});

test('create-channel dialog submits and composer uploads and persists a message', async () => {
  const { store } = await import('@/features/store');
  const client = trpc.getTRPCClient();
  openDialog(Dialog.CREATE_CHANNEL, { categoryId: 1 });
  await page
    .getByRole('textbox', { name: 'Channel name', exact: true })
    .fill('release-regression');
  await page.getByRole('radio', { name: 'Voice channel' }).click();
  await expect
    .element(page.getByRole('radio', { name: 'Voice channel' }))
    .toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Text channel' }).click();
  await page
    .getByRole('button', { name: 'Create channel', exact: true })
    .click();
  const item = page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'release-regression' });
  await expect.element(item).toBeVisible();
  const channel = store
    .getState()
    .server.channels.find((c) => c.name === 'release-regression')!;
  expect(channel.type).toBe('TEXT');
  expect(channel.categoryId).toBe(1);
  try {
    await item.click();
    await expect
      .element(
        page.getByText('Welcome to #release-regression', { exact: true })
      )
      .toBeVisible();
    const editor = page.elementLocator(
      document.querySelector<HTMLElement>('.compose-container .ProseMirror')!
    );
    await editor.fill('Release integration submission');
    const input = document.querySelector<HTMLInputElement>(
      '.compose-container input[type=file]'
    )!;
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['release-upload-fixture'], 'release-check.txt', {
        type: 'text/plain'
      })
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await expect
      .element(page.getByText('release-check.txt', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Send message', exact: true }))
      .toBeEnabled();
    await page
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect
      .element(
        page
          .getByTestId(TestId.MESSAGE_ITEM)
          .filter({ hasText: 'Release integration submission' })
      )
      .toBeVisible();
    const saved = await client.messages.get.query({
      channelId: channel.id,
      limit: 50,
      cursor: null
    });
    expect(saved.messages).toHaveLength(1);
    expect(saved.messages[0].content).toContain(
      'Release integration submission'
    );
    expect(saved.messages[0].files).toHaveLength(1);
    expect(saved.messages[0].files[0].originalName).toBe('release-check.txt');
    const { getFileUrl } = await import('@/helpers/get-file-url');
    const download = await fetch(getFileUrl(saved.messages[0].files[0]));
    expect(download.ok).toBe(true);
    expect(await download.text()).toBe('release-upload-fixture');
    expect(
      document.querySelector('.compose-container .ProseMirror')!.textContent
    ).toBe('');
  } finally {
    setSelectedChannelId(1);
    await client.channels.delete.mutate({ channelId: channel.id });
    await expect.element(item).not.toBeInTheDocument();
  }
});

test('paginated history suppresses welcome until the oldest page and keeps unique day boundaries', async () => {
  const { ChannelType } = await import('@dodecagon/shared');
  const client = trpc.getTRPCClient();
  const original = await client.messages.get.query({
    channelId: 1,
    limit: 50,
    cursor: null
  });
  const template = original.messages[0];
  const channelId = await client.channels.add.mutate({
    name: 'pagination-regression',
    type: ChannelType.TEXT,
    categoryId: 1
  });
  const older = {
    ...template,
    id: 910001,
    channelId,
    content: 'Oldest paginated message',
    createdAt: Date.UTC(2026, 9, 7, 12)
  };
  const recent = Array.from({ length: 50 }, (_, index) => ({
    ...template,
    id: 910002 + index,
    channelId,
    content:
      index === 49 ? 'Latest paginated message' : `Paginated message ${index}`,
    createdAt: Date.UTC(2026, 9, index < 25 ? 8 : 9, 9, (index % 25) * 2)
  }));
  const query = vi
    .fn(client.messages.get.query)
    .mockImplementation(async (input) => {
      if (input.channelId !== channelId)
        return client.messages.get.query(input);
      return input.cursor
        ? { messages: [older], nextCursor: null, hasNewer: false }
        : {
            messages: [...recent].reverse(),
            nextCursor: { id: recent[0].id, createdAt: recent[0].createdAt },
            hasNewer: false
          };
    });
  const fixtureClient = new Proxy(client, {
    get(target, property) {
      if (property !== 'messages') return Reflect.get(target, property);
      return new Proxy(target.messages, {
        get(messages, key) {
          if (key !== 'get') return Reflect.get(messages, key);
          return new Proxy(messages.get, {
            get(get, method) {
              return method === 'query' ? query : Reflect.get(get, method);
            }
          });
        }
      });
    }
  });
  vi.mocked(trpc.getTRPCClient).mockReturnValue(fixtureClient);
  try {
    setSelectedChannelId(channelId);
    await expect
      .element(page.getByText('Latest paginated message', { exact: true }))
      .toBeVisible();
    expect(document.querySelector('[data-channel-welcome]')).toBeNull();
    await waitForRender();
    await waitForRender();
    const container = document.querySelector<HTMLElement>(
      '[data-messages-container]'
    )!;
    expect(container.scrollHeight).toBeGreaterThan(container.clientHeight);
    await expect
      .poll(
        () => {
          container.scrollTop = 0;
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
          return query.mock.calls.length;
        },
        { timeout: 3000 }
      )
      .toBe(2);
    await expect
      .element(
        page.getByText('Welcome to #pagination-regression', { exact: true })
      )
      .toBeInTheDocument();
    await waitForRender();
    container.scrollTop = 0;
    await expect
      .element(
        page.getByText('Welcome to #pagination-regression', { exact: true })
      )
      .toBeVisible();
    await expect
      .element(page.getByText('October 7th, 2026', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText('October 8th, 2026', { exact: true }))
      .toBeVisible();
    await scrollToVirtualMessage(channelId, recent[25].id);
    await expect
      .element(page.getByText('Today', { exact: true }))
      .toBeVisible();
    expect(
      Array.from(container.querySelectorAll('[data-message-date]')).filter(
        (element) => element.textContent === 'Today'
      )
    ).toHaveLength(1);
    await scrollToVirtualMessage(channelId, older.id);
    await expect
      .element(page.getByText('Oldest paginated message', { exact: true }))
      .toBeVisible();
  } finally {
    vi.mocked(trpc.getTRPCClient).mockReturnValue(client);
    setSelectedChannelId(1);
    await client.channels.delete.mutate({ channelId });
  }
});

test('redesigned channel header preserves upstream mute and unmute control', async () => {
  const { toggleChannelMuted } = await import('@/features/app/actions');
  const muteToggle = `[data-testid="${TestId.CHANNEL_MUTE_TOGGLE}"]`;
  toggleChannelMuted(1);
  await waitForRender();
  const button = page.elementLocator(
    document.querySelector<HTMLButtonElement>(muteToggle)!
  );
  expect(button.element()).not.toBeNull();
  try {
    await button.hover();
    await expect
      .poll(
        () =>
          document.querySelector('[data-slot="tooltip-content"]')?.textContent,
        { timeout: 3_000 }
      )
      .toContain('Channel muted');
    await expect
      .element(
        page.getByRole('tooltip', { name: 'Channel muted, click to unmute' })
      )
      .toBeVisible();
    const tooltip = document.querySelector('[data-slot="tooltip-content"]')!;
    expect(getComputedStyle(tooltip).backgroundColor).toBe('rgb(30, 31, 34)');
    expect(getComputedStyle(tooltip).color).toBe('rgb(242, 243, 245)');
    await button.click();
    await expect.poll(() => document.querySelector(muteToggle)).toBeNull();
  } finally {
    if (document.querySelector(muteToggle)) toggleChannelMuted(1);
  }
});

test('warm A-B-A switching shows cached messages before delayed revalidation', async () => {
  const { ChannelType } = await import('@dodecagon/shared');
  const client = trpc.getTRPCClient();
  const originalA = await client.messages.get.query({
    channelId: 1,
    limit: 50,
    cursor: null
  });
  const bChannelId = await client.channels.add.mutate({
    name: 'warm-switch-regression',
    type: ChannelType.TEXT,
    categoryId: 1
  });
  let aMessageId: number | undefined;
  const { promise: delayedARequest, resolve: noteARequest } =
    Promise.withResolvers<void>();
  const { promise: releaseDelayedA, resolve: releaseARequest } =
    Promise.withResolvers<void>();
  const { promise: delayedAResponseFinished, resolve: noteAResponseFinished } =
    Promise.withResolvers<void>();
  const { promise: bRequestFinished, resolve: noteBRequestFinished } =
    Promise.withResolvers<void>();
  let delayNextARequest = false;
  let delayedARequestStarted = false;
  const query = vi
    .fn(client.messages.get.query)
    .mockImplementation(async (input) => {
      let wasDelayedARequest = false;
      try {
        if (input.channelId === 1 && delayNextARequest) {
          delayNextARequest = false;
          delayedARequestStarted = true;
          wasDelayedARequest = true;
          noteARequest();
          await releaseDelayedA;
        }
        return await client.messages.get.query(input);
      } finally {
        if (wasDelayedARequest) noteAResponseFinished();
        if (input.channelId === bChannelId) noteBRequestFinished();
      }
    });
  const fixtureClient = new Proxy(client, {
    get(target, property) {
      if (property !== 'messages') return Reflect.get(target, property);
      return new Proxy(target.messages, {
        get(messages, key) {
          if (key !== 'get') return Reflect.get(messages, key);
          return new Proxy(messages.get, {
            get(get, method) {
              return method === 'query' ? query : Reflect.get(get, method);
            }
          });
        }
      });
    }
  });
  vi.mocked(trpc.getTRPCClient).mockReturnValue(fixtureClient);
  let releaseTimer: number | undefined;
  let networkReleasedAt = Number.POSITIVE_INFINITY;
  try {
    aMessageId = await client.messages.send.mutate({
      clientRequestId: crypto.randomUUID(),
      channelId: 1,
      content: 'Warm A marker 24',
      files: []
    });
    const bMessageId = await client.messages.send.mutate({
      clientRequestId: crypto.randomUUID(),
      channelId: bChannelId,
      content: 'Warm B marker 24',
      files: []
    });
    const cachedA = [
      await client.messages.getOne.query({ messageId: aMessageId })
    ];
    const cachedB = [
      await client.messages.getOne.query({ messageId: bMessageId })
    ];
    await writeMessageWindow(store, 1, cachedA, false);
    await writeMessageWindow(store, bChannelId, cachedB, false);
    await expect
      .element(page.getByText('Warm A marker 24', { exact: true }))
      .toBeVisible();
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: getMessageWindow(store, bChannelId).rowsKey,
      refetchType: 'none'
    });

    await page
      .getByTestId(TestId.CHANNEL_ITEM)
      .filter({ hasText: 'warm-switch-regression' })
      .click();
    await expect
      .element(page.getByText('Warm B marker 24', { exact: true }))
      .toBeVisible();
    await bRequestFinished;
    await waitForRender();
    expect(document.body.textContent).not.toContain('Warm A marker 24');

    delayNextARequest = true;
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: getMessageWindow(store, 1).rowsKey,
      refetchType: 'none'
    });
    const switchStartedAt = performance.now();
    releaseTimer = window.setTimeout(() => {
      networkReleasedAt = performance.now();
      releaseARequest();
    }, 900);
    await page
      .getByTestId(TestId.CHANNEL_ITEM)
      .filter({ hasText: 'general' })
      .click();
    await delayedARequest;

    const isVisuallyReady = () => {
      const container = document.querySelector<HTMLElement>(
        '[data-messages-container]'
      );
      const editor = document.querySelector<HTMLElement>(
        '.compose-container .ProseMirror'
      );
      const marker = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid="${TestId.MESSAGE_ITEM}"]`
        )
      ).find((element) => element.textContent?.includes('Warm A marker 24'));
      if (!container || !editor?.isContentEditable || !marker) return false;

      const containerRect = container.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const distanceFromBottom =
        container.scrollHeight - container.clientHeight - container.scrollTop;
      return (
        markerRect.bottom > containerRect.top &&
        markerRect.top < containerRect.bottom &&
        distanceFromBottom <= 1 &&
        Number(getComputedStyle(container).opacity) >= 0.99
      );
    };
    await expect
      .poll(isVisuallyReady, { timeout: 4_000, interval: 10 })
      .toBe(true);
    const switchReadyAt = performance.now();
    const readyMs = switchReadyAt - switchStartedAt;
    const readyBeforeNetworkRelease = !Number.isFinite(networkReleasedAt);
    console.info(
      `[channel-switch-perf] warm A-B-A: visual+editor ready ${readyMs.toFixed(1)}ms before delayed response release`
    );
    expect(readyBeforeNetworkRelease).toBe(true);
    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>('[data-messages-container]')!
      ).animationDuration
    ).toBe('0s');
    await delayedAResponseFinished;
    await waitForRender();
    const delayedResponseMs = networkReleasedAt - switchStartedAt;
    console.info(
      `[channel-switch-perf] delayed response released ${delayedResponseMs.toFixed(1)}ms after the channel click`
    );
    expect(switchReadyAt).toBeLessThan(networkReleasedAt);
    expect(
      document.querySelector('[data-messages-container]')?.textContent
    ).toContain('Warm A marker 24');
    expect(
      document.querySelector('[data-messages-container]')?.textContent
    ).not.toContain('Warm B marker 24');
  } finally {
    if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
    releaseARequest();
    if (delayedARequestStarted) await delayedAResponseFinished;
    vi.mocked(trpc.getTRPCClient).mockReturnValue(client);
    if (aMessageId !== undefined) {
      await client.messages.delete.mutate({ messageId: aMessageId });
    }
    setSelectedChannelId(1);
    await waitForRender();
    await writeMessageWindow(
      store,
      1,
      [...originalA.messages].reverse(),
      false
    );
    await writeMessageWindow(store, bChannelId, [], false);
    await client.channels.delete.mutate({ channelId: bChannelId });
    await waitForRender();
  }
});

test('compact call toolbar disconnects the real voice session', async () => {
  const { store } = await import('@/features/store');
  const { currentVoiceChannelIdSelector } =
    await import('@/features/server/channels/selectors');
  setSelectedChannelId(2);
  await joinVoice(2);
  await waitForRender();
  try {
    await expect
      .element(page.getByRole('button', { name: 'Mute', exact: true }))
      .toBeInTheDocument();
    await revealVoiceControls();
    const controls = document.querySelector<HTMLElement>(
      '[data-voice-controls]'
    )!;
    const disconnect = controls.querySelector<HTMLButtonElement>(
      'button[aria-label="Disconnect"]'
    )!;
    await page.elementLocator(disconnect).click();
    await expect
      .poll(() => {
        const state = store.getState();
        return currentVoiceChannelIdSelector(state);
      })
      .toBeUndefined();
  } finally {
    await leaveVoice({ reason: 'user_disconnect_button' });
    setSelectedChannelId(1);
  }
});
