const messageHighlightTimeouts = new WeakMap<Element, NodeJS.Timeout>();

type TVirtualMessageScroller = (messageId: number) => Promise<Element | null>;
const virtualMessageScrollers = new Map<string, TVirtualMessageScroller>();

export const registerVirtualMessageList = (
  channelId: number,
  scroll: TVirtualMessageScroller,
  parentMessageId?: number
) => {
  const key = `${channelId}:${parentMessageId ?? 'channel'}`;
  virtualMessageScrollers.set(key, scroll);

  return () => {
    if (virtualMessageScrollers.get(key) === scroll) {
      virtualMessageScrollers.delete(key);
    }
  };
};

export const scrollToVirtualMessage = async (
  channelId: number,
  messageId: number,
  parentMessageId?: number
): Promise<Element | null> => {
  const scroll = virtualMessageScrollers.get(
    `${channelId}:${parentMessageId ?? 'channel'}`
  );
  return scroll ? scroll(messageId) : null;
};

export const getMessagesContainer = (parentMessageId?: number) => {
  if (parentMessageId !== undefined) {
    return document.querySelector(
      `[data-thread-messages][data-parent-message-id="${parentMessageId}"]`
    );
  }
  return document.querySelector('[data-messages-container]');
};

export const findMessageElement = (
  messageId: number,
  parentMessageId?: number
) => {
  const container = getMessagesContainer(parentMessageId);
  return container?.querySelector(`[data-message-id="${messageId}"]`) ?? null;
};

export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const highlightMessageElement = async (
  element: Element,
  highlightTime: number
) => {
  // yield twice to ensure the element is rendered and any pending layout calculations are done before we try to scroll to it and apply the highlight styles
  await nextFrame();
  await nextFrame();

  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  element.classList.add('bg-secondary');

  if (messageHighlightTimeouts.has(element)) {
    clearTimeout(messageHighlightTimeouts.get(element));
  }

  const timeoutId = setTimeout(() => {
    element.classList.remove('bg-secondary');

    messageHighlightTimeouts.delete(element);
  }, highlightTime);

  messageHighlightTimeouts.set(element, timeoutId);
};

export const waitForMessageElement = (
  messageId: number,
  timeoutMs = 3000,
  parentMessageId?: number
): Promise<Element | null> =>
  new Promise((resolve) => {
    const existing = findMessageElement(messageId, parentMessageId);

    if (existing) {
      resolve(existing);
      return;
    }

    const container = getMessagesContainer(parentMessageId);

    if (!container) {
      resolve(null);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = findMessageElement(messageId, parentMessageId);

      if (element) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(element);
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    observer.observe(container, { childList: true, subtree: true });
  });
