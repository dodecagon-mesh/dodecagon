import {
  MessageHistory,
  type TMessageHistoryHandle
} from '@/components/channel-view/text/message-history';
import {
  highlightMessageElement,
  scrollToVirtualMessage
} from '@/features/server/messages/helpers';
import { i18n } from '@/i18n';
import type { TJoinedMessage } from '@dodecagon/shared';
import { StrictMode, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';

const messages = (start: number, count: number): TJoinedMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: start + index,
    channelId: 987654,
    content: `<p>History message ${start + index}</p>`,
    clientRequestId: null,
    userId: null,
    pluginId: 'history-fixture',
    parentMessageId: null,
    replyToMessageId: null,
    editable: false,
    metadata: null,
    createdAt: Date.UTC(2026, 9, 20, 12) + start + index,
    updatedAt: null,
    pinned: false,
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    editedBy: null,
    files: [],
    reactions: []
  }));

const settle = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const readVisibleAnchor = (host: HTMLElement, container: HTMLElement) => {
  const viewport = container.getBoundingClientRect();
  const message = Array.from(
    host.querySelectorAll<HTMLElement>('[data-message-id]')
  ).find((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  if (!message) throw new Error('No visible message in the reading viewport');
  return {
    id: message.dataset.messageId,
    offset: message.getBoundingClientRect().top - viewport.top
  };
};

const fixture = async (
  initial: TJoinedMessage[],
  compact = false,
  initiallyLoading = false
) => {
  const host = document.createElement('div');
  host.style.cssText =
    'height:320px;width:480px;display:flex;flex-direction:column';
  document.body.append(host);
  const root = createRoot(host);
  const ref = createRef<TMessageHistoryHandle>();
  const render = (items: TJoinedMessage[], fetching = false) =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MessageHistory, {
            ref,
            channelId: 987654,
            parentMessageId: compact ? 123 : undefined,
            compact,
            messages: items,
            loading: fetching && items.length === 0,
            fetching,
            hasMore: false,
            loadMore: async () => undefined
          })
        )
      )
    );
  if (initiallyLoading) {
    render([], true);
    await settle();
  }
  render(initial);
  await expect
    .poll(() => host.querySelector('[data-message-id]'))
    .not.toBeNull();
  const container = host.querySelector<HTMLElement>(
    compact ? '[data-thread-messages]' : '[data-messages-container]'
  )!;
  const fromBottom = () =>
    container.scrollHeight - container.scrollTop - container.clientHeight;
  await expect.poll(fromBottom).toBeLessThanOrEqual(2);
  await settle();
  return {
    host,
    container,
    ref,
    render,
    fromBottom,
    close: () => {
      root.unmount();
      host.remove();
    }
  };
};

for (const compact of [false, true]) {
  test(`thousands of ${compact ? 'thread replies' : 'same-author messages'} mount only a bounded visible range`, async () => {
    const view = await fixture(messages(1, 5000), compact);
    try {
      expect(
        view.host.querySelectorAll('[data-message-id]').length
      ).toBeLessThan(100);
      expect(
        view.host.querySelector('[data-message-id="5000"]')
      ).not.toBeNull();
      expect(view.host.querySelector('[data-message-id="1"]')).toBeNull();
      view.container.scrollTop = 0;
      await expect
        .poll(() => view.host.querySelector('[data-message-id="1"]'))
        .not.toBeNull();
      expect(
        view.host.querySelectorAll('[data-message-id]').length
      ).toBeLessThan(100);
    } finally {
      view.close();
    }
  });
}

test('prepend holds the visible message at the same reading offset', async () => {
  const original = messages(501, 500);
  const view = await fixture(original);
  try {
    view.container.scrollTop = 180;
    await settle();
    const visible = Array.from(
      view.host.querySelectorAll<HTMLElement>('[data-message-id]')
    ).find(
      (element) =>
        element.getBoundingClientRect().top >=
        view.container.getBoundingClientRect().top
    )!;
    const id = visible.dataset.messageId;
    const before = visible.getBoundingClientRect().top;
    view.render([...messages(1, 500), ...original]);
    await expect
      .poll(() => {
        const anchor = view.host.querySelector<HTMLElement>(
          `[data-message-id="${id}"]`
        );
        return anchor
          ? Math.abs(anchor.getBoundingClientRect().top - before)
          : Infinity;
      })
      .toBeLessThanOrEqual(2);
  } finally {
    view.close();
  }
});

for (const compact of [false, true]) {
  test(`jumping to a loaded unmounted ${compact ? 'thread reply' : 'message'} mounts and highlights its actual row`, async () => {
    const view = await fixture(messages(1, 5000), compact);
    try {
      const target = await scrollToVirtualMessage(
        987654,
        42,
        compact ? 123 : undefined
      );
      expect(target).not.toBeNull();
      await highlightMessageElement(target!, 500);
      expect(target!.classList.contains('bg-secondary')).toBe(true);
      const bounds = target!.getBoundingClientRect();
      const viewport = view.container.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
      expect(
        view.host.querySelectorAll('[data-message-id]').length
      ).toBeLessThan(100);
    } finally {
      view.close();
    }
  });
}

for (const compact of [false, true]) {
  test(`a small upward scroll releases ${compact ? 'thread' : 'channel'} bottom lock before late media resize`, async () => {
    const view = await fixture(messages(1, 100), compact);
    try {
      await page.elementLocator(view.container).wheel({ delta: { y: -60 } });
      await expect.poll(view.fromBottom).toBeGreaterThanOrEqual(59);
      const before = readVisibleAnchor(view.host, view.container);
      const last = view.host.querySelector<HTMLElement>(
        '[data-message-id="100"]'
      )!;
      last.style.minHeight = '450px';
      await settle();
      const after = readVisibleAnchor(view.host, view.container);
      expect(after.id).toBe(before.id);
      expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
    } finally {
      view.close();
    }
  });
}

for (const readerScrolledUp of [false, true]) {
  test(
    readerScrolledUp
      ? 'late media growth and appended messages do not yank a history reader'
      : 'late media growth and appended messages preserve bottom lock',
    async () => {
      const original = messages(1, 500);
      const view = await fixture(original);
      view.render(original, true);
      await settle();
      view.render(original, false);
      await settle();
      try {
        if (readerScrolledUp) {
          view.container.scrollTop -= 1500;
          await settle();
        }
        const before = readVisibleAnchor(view.host, view.container);
        const mounted =
          view.host.querySelectorAll<HTMLElement>('[data-message-id]');
        const media = mounted[mounted.length - 1];
        media.style.minHeight = '450px';
        media.dispatchEvent(new Event('load', { bubbles: true }));
        await settle();
        if (readerScrolledUp) {
          const afterResize = readVisibleAnchor(view.host, view.container);
          expect(afterResize.id).toBe(before.id);
          expect(
            Math.abs(afterResize.offset - before.offset)
          ).toBeLessThanOrEqual(2);
        }
        view.render([...original, ...messages(501, 1)]);
        await settle();
        if (readerScrolledUp) {
          const afterAppend = readVisibleAnchor(view.host, view.container);
          expect(afterAppend.id).toBe(before.id);
          expect(
            Math.abs(afterAppend.offset - before.offset)
          ).toBeLessThanOrEqual(2);
          expect(view.fromBottom()).toBeGreaterThan(600);
        } else {
          await expect.poll(view.fromBottom).toBeLessThanOrEqual(2);
        }
      } finally {
        view.close();
      }
    }
  );
}

test('history arriving after the loading state keeps following late media resize', async () => {
  const view = await fixture(messages(1, 100), false, true);
  try {
    const last = view.host.querySelector<HTMLElement>(
      '[data-message-id="100"]'
    )!;
    last.style.minHeight = '500px';
    last.dispatchEvent(new Event('load', { bubbles: true }));
    await expect.poll(view.fromBottom).toBeLessThanOrEqual(2);
  } finally {
    view.close();
  }
});

test('an append during a programmatic history jump does not follow output to the present', async () => {
  const original = messages(1, 5000);
  const view = await fixture(original);
  try {
    const target = await scrollToVirtualMessage(987654, 42);
    expect(target).not.toBeNull();
    view.render([...original, ...messages(5001, 1)]);
    await settle();
    await settle();
    expect(view.fromBottom()).toBeGreaterThan(600);
    const mounted = view.host.querySelector<HTMLElement>(
      '[data-message-id="42"]'
    );
    expect(mounted).not.toBeNull();
    const viewport = view.container.getBoundingClientRect();
    expect(mounted!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      viewport.top
    );
    expect(mounted!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      viewport.bottom
    );
  } finally {
    view.close();
  }
});

test('a thread inline-reply preview reveals its loaded offscreen target in the thread', async () => {
  const original = messages(1, 5000);
  original[4999] = {
    ...original[4999],
    parentMessageId: 123,
    replyToMessageId: 42,
    replyTo: {
      id: 42,
      content: 'Thread target to reveal',
      userId: null,
      pluginId: 'history-fixture'
    }
  };
  const view = await fixture(original, true);
  try {
    const trigger = Array.from(view.host.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Thread target to reveal')
    );
    expect(trigger).toBeDefined();
    trigger!.click();
    await expect
      .poll(() =>
        view.host
          .querySelector('[data-message-id="42"]')
          ?.classList.contains('bg-secondary')
      )
      .toBe(true);
    expect(view.host.querySelectorAll('[data-message-id]').length).toBeLessThan(
      100
    );
    expect(view.fromBottom()).toBeGreaterThan(600);
  } finally {
    view.close();
  }
});
