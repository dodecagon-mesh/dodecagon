import { MessagesGroup } from '@/components/channel-view/text/messages-group';
import { ErrorBoundary } from '@/components/error-boundary';
import { ThreadSidebar } from '@/components/thread-sidebar';
import { ParentMessagePreview } from '@/components/thread-sidebar/parent-message-preview';
import { closeThreadSidebar, openThreadSidebar } from '@/features/app/actions';
import { setSelectedChannelId } from '@/features/server/channels/actions';
import {
  readMessages,
  writeMessageWindow,
  writeSyncedMessage
} from '@/features/server/messages/database';
import { store } from '@/features/store';
import { LocalStorageKey } from '@/helpers/storage';
import { getTRPCClient } from '@/lib/trpc';
import { TestId, type TJoinedMessage } from '@dodecagon/shared';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test
} from 'vitest';
import { page, userEvent } from 'vitest/browser';

let appRoot: Root;
let fixtureRoot: Root | undefined;
let fixtureHost: HTMLDivElement | undefined;
let parent: TJoinedMessage;
let paginationParent: TJoinedMessage;
let replies: TJoinedMessage[];

const settle = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const waitForSelector = async (selector: string, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (document.querySelector(selector)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${selector}`);
};

const panel = () => {
  const handles =
    document.querySelectorAll<HTMLDivElement>('.cursor-col-resize');
  const handle = Array.from(handles).find((element) =>
    element.parentElement?.querySelector('.compose-container')
  );
  expect(handle).toBeDefined();
  return handle!.parentElement!;
};

const openThread = async (message: TJoinedMessage) => {
  openThreadSidebar(message.id, message.channelId);
  await expect
    .poll(() => {
      return readMessages(store, 1, message.id).length;
    })
    .toBeGreaterThan(0);
  await settle();
  return panel();
};

const renderFixture = async (
  children: React.ReactNode,
  message = parent,
  threadReplies = replies
) => {
  await writeSyncedMessage(store, message);
  await writeMessageWindow(
    store,
    message.channelId,
    threadReplies,
    false,
    message.id
  );
  fixtureHost = document.createElement('div');
  fixtureHost.style.cssText =
    'position:fixed;left:0;top:0;width:500px;height:900px;background:var(--color-nav);z-index:1000';
  document.body.append(fixtureHost);
  fixtureRoot = createRoot(fixtureHost);
  fixtureRoot.render(children);
  await settle();
  return fixtureHost;
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
  appRoot = createRoot(document.getElementById('root')!);
  appRoot.render(createElement(ClientApp));
  await document.fonts.ready;
  await page.getByTestId(TestId.CONNECT_IDENTITY_INPUT).fill('rnd332');
  await page.getByTestId(TestId.CONNECT_PASSWORD_INPUT).fill('password123');
  await page.getByTestId(TestId.CONNECT_BUTTON).click();
  await page
    .getByTestId(TestId.CHANNEL_ITEM)
    .filter({ hasText: 'general' })
    .click();
  await waitForSelector(`[data-testid="${TestId.MESSAGE_ITEM}"]`);
  const trpc = getTRPCClient();
  const history = await trpc.messages.get.query({ channelId: 1 });
  parent = history.messages.find((message) =>
    message.content?.startsWith('Welcome back')
  )!;
  paginationParent = history.messages.find(
    (message) => message.content === 'Pagination thread parent'
  )!;
  const thread = await trpc.messages.getThread.query({
    parentMessageId: parent.id
  });
  replies = thread.messages;
  expect(parent.replyCount).toBe(2);
  expect(paginationParent.replyCount).toBe(137);
});

beforeEach(async () => {
  closeThreadSidebar();
  setSelectedChannelId(1);
  await settle();
});

afterEach(() => {
  fixtureRoot?.unmount();
  fixtureRoot = undefined;
  fixtureHost?.remove();
  fixtureHost = undefined;
  closeThreadSidebar();
});

afterAll(() => {
  appRoot.unmount();
});

test('thread context uses the source channel and Paper hierarchy without changing the channel composer', async () => {
  const channelComposer = document.querySelector('.compose-scroll-row')!;
  const channelStyle = getComputedStyle(channelComposer);
  expect(channelComposer.getBoundingClientRect().height).toBe(52);
  expect(channelStyle.paddingLeft).toBe('16px');
  const thread = await openThread(parent);
  await expect
    .element(page.getByRole('heading', { name: 'Thread in #general' }))
    .toBeVisible();
  expect(thread.getBoundingClientRect().width).toBe(392);
  const parentContent = page
    .getByText('Welcome back', { exact: false })
    .all()
    .find((locator) => thread.contains(locator.element()));
  expect(parentContent).toBeDefined();
  const parentTime = thread.querySelector<HTMLTimeElement>(
    '[data-thread-parent] time'
  )!;
  expect(parentTime.textContent).toBe('9:40 AM');
  expect(parentTime.dateTime).toBe('2026-10-09T09:40:00.000Z');
  expect(parentTime.title).toContain('2026');
  const parentBlock = thread.querySelector<HTMLElement>(
    '[data-thread-parent]'
  )!;
  expect(getComputedStyle(parentBlock).paddingLeft).toBe('24px');
  expect(getComputedStyle(parentBlock).paddingTop).toBe('22px');
  expect(thread.querySelector('[data-thread-reply-count]')?.textContent).toBe(
    '2 replies'
  );
  const content = thread.querySelector<HTMLElement>(
    '[data-message-id] .msg-content'
  )!;
  expect(getComputedStyle(content).fontSize).toBe('14px');
  expect(getComputedStyle(content).lineHeight).toBe('22px');
  const avatar = thread.querySelector<HTMLElement>(
    '[data-message-group] [data-slot="avatar"]'
  )!;
  expect(avatar.getBoundingClientRect().width).toBe(28);
  const composer = thread.querySelector<HTMLElement>('.compose-scroll-row')!;
  expect(composer.getBoundingClientRect().height).toBe(44);
  expect(
    composer.getBoundingClientRect().left - thread.getBoundingClientRect().left
  ).toBe(24);
  expect(getComputedStyle(channelComposer).paddingLeft).toBe('16px');
  expect(channelComposer.getBoundingClientRect().height).toBe(52);
  setSelectedChannelId(2);
  await expect
    .element(page.getByRole('heading', { name: 'Thread in #general' }))
    .toBeVisible();
  setSelectedChannelId(1);
  await settle();
  await expect(page.elementLocator(document.documentElement)).toMatchScreenshot(
    'thread-context-paper'
  );
});

test('the authoritative 137 reply count survives loading another real page', async () => {
  const thread = await openThread(paginationParent);
  const count = thread.querySelector('[data-thread-reply-count]');
  expect(count?.textContent).toBe('137 replies');
  expect(
    readMessages(store, 1, paginationParent.id).length
  ).toBeGreaterThanOrEqual(50);
  const scroller = thread.querySelector<HTMLElement>('[data-thread-messages]')!;
  await expect
    .poll(
      () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    )
    .toBeLessThan(2);
  await page.elementLocator(scroller).wheel({ delta: { y: -10_000 } });
  await expect
    .poll(() => {
      return readMessages(store, 1, paginationParent.id).length;
    })
    .toBeGreaterThanOrEqual(100);
  expect(count?.textContent).toBe('137 replies');
});

test('baseline pagination probe records oldest-first loading and the scroll position', async () => {
  const thread = await openThread(paginationParent);
  const scroller = thread.querySelector<HTMLElement>('.overflow-y-auto')!;
  const firstPage = readMessages(store, 1, paginationParent.id);
  expect(firstPage.length).toBeGreaterThanOrEqual(50);
  expect(firstPage[0].content).toContain('Pagination reply 001.');
  expect(firstPage[49].content).toContain('Pagination reply 050.');
  await expect
    .poll(
      () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    )
    .toBeLessThan(2);
  await page.elementLocator(scroller).wheel({ delta: { y: -10_000 } });
  await expect
    .poll(() => {
      return readMessages(store, 1, paginationParent.id).length;
    })
    .toBeGreaterThanOrEqual(100);
  await settle();
  const loaded = readMessages(store, 1, paginationParent.id);
  console.info('thread pagination probe', {
    first: loaded[0].content,
    last: loaded[loaded.length - 1].content,
    loaded: loaded.length,
    scrollTop: scroller.scrollTop,
    height: scroller.scrollHeight,
    viewport: scroller.clientHeight
  });
});

test.each([NaN, Infinity, 8_640_000_000_000_001])(
  'invalid parent timestamp %s keeps context readable',
  async (createdAt) => {
    openThreadSidebar(parent.id, 1);
    const host = await renderFixture(
      createElement(ParentMessagePreview, { messageId: parent.id }),
      { ...parent, createdAt }
    );
    expect(host.textContent).toContain('Unknown time');
    expect(host.textContent).toContain('aria');
    expect(host.querySelector('time')).toBeNull();
  }
);

test('epoch zero is a valid parent timestamp', async () => {
  openThreadSidebar(parent.id, 1);
  const host = await renderFixture(
    createElement(ParentMessagePreview, { messageId: parent.id }),
    { ...parent, createdAt: 0 }
  );
  const time = host.querySelector('time')!;
  expect(time.dateTime).toBe('1970-01-01T00:00:00.000Z');
  expect(time.textContent).toBe('12:00 AM');
});

test('compact replies tolerate an invalid date while epoch zero stays machine-readable', async () => {
  const group = [{ ...replies[0], createdAt: NaN }];
  const fallback = () => createElement('div', {}, 'Reply render failed');
  const host = await renderFixture(
    createElement(ErrorBoundary, {
      fallback,
      children: createElement(MessagesGroup, {
        group,
        compact: true,
        showClockTime: true
      })
    })
  );
  expect(host.textContent).toContain('Unknown time');
  expect(host.textContent).not.toContain('Reply render failed');
  fixtureRoot!.render(
    createElement(MessagesGroup, {
      group: [{ ...replies[0], createdAt: 0 }],
      compact: true,
      showClockTime: true
    })
  );
  await settle();
  expect(host.querySelector('time')?.dateTime).toBe('1970-01-01T00:00:00.000Z');
});

test('saved thread width survives a fresh sidebar mount', async () => {
  localStorage.setItem(LocalStorageKey.THREAD_SIDEBAR_WIDTH, '480');
  openThreadSidebar(parent.id, 1);
  const host = await renderFixture(
    createElement(ThreadSidebar, { isOpen: true })
  );
  const sidebar = host.querySelector<HTMLElement>('[style*="width"]')!;
  expect(sidebar.getBoundingClientRect().width).toBe(480);
  expect(localStorage.getItem(LocalStorageKey.THREAD_SIDEBAR_WIDTH)).toBe(
    '480'
  );
  localStorage.removeItem(LocalStorageKey.THREAD_SIDEBAR_WIDTH);
});

test('opening from the message and sending a reply preserves parent context and keyboard close', async () => {
  const rootMessage = document.querySelector<HTMLElement>(
    `[data-message-id="${parent.id}"]`
  )!;
  await page
    .elementLocator(rootMessage)
    .getByRole('button', { name: '2 replies' })
    .click();
  await expect
    .element(page.getByRole('heading', { name: 'Thread in #general' }))
    .toBeVisible();
  const thread = panel();
  const editor = thread.querySelector<HTMLElement>(
    `[data-testid="${TestId.MESSAGE_COMPOSE_EDITOR}"]`
  )!;
  await page.elementLocator(editor).click();
  await userEvent.type(page.elementLocator(editor), 'A real thread reply');
  await userEvent.keyboard('{Enter}');
  const trpc = getTRPCClient();
  let sentId: number | undefined;
  try {
    await expect
      .poll(async () => {
        const result = await trpc.messages.getThread.query({
          parentMessageId: parent.id
        });
        const sent = result.messages.find((message) =>
          message.content?.includes('A real thread reply')
        );
        sentId = sent?.id;
        return sent?.parentMessageId;
      })
      .toBe(parent.id);
    expect(rootMessage.isConnected).toBe(true);
    await expect
      .poll(
        () => thread.querySelector('[data-thread-reply-count]')?.textContent
      )
      .toBe('3 replies');
    await expect.poll(() => editor.textContent).toBe('');
    const close = page.getByRole('button', {
      name: 'Close thread',
      exact: true
    });
    await close.click();
    await expect
      .element(page.getByRole('heading', { name: 'Thread in #general' }))
      .not.toBeInTheDocument();
    await page
      .elementLocator(rootMessage)
      .getByRole('button', { name: '3 replies' })
      .click();
    await expect
      .element(page.getByRole('heading', { name: 'Thread in #general' }))
      .toBeVisible();
    const closeAgain = page.getByRole('button', {
      name: 'Close thread',
      exact: true
    });
    const closeElement = closeAgain.element();
    closeElement.focus();
    await userEvent.keyboard('{Enter}');
    await expect
      .element(page.getByRole('heading', { name: 'Thread in #general' }))
      .not.toBeInTheDocument();
    expect(readMessages(store, 1)).toContainEqual(
      expect.objectContaining({ id: parent.id })
    );
  } finally {
    if (sentId) await trpc.messages.delete.mutate({ messageId: sentId });
  }
});
