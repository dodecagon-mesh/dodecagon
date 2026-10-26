import { threadChannelIdSelector } from '@/features/app/selectors';
import { useStoreSelector } from '@/features/store';
import { useStore } from '@/features/store-context';
import { logDebug } from '@/helpers/browser-logger';
import { getTrpcError } from '@dodecagon/shared';
import { eq } from '@tanstack/db';
import { isCancelledError, QueryObserver } from '@tanstack/query-core';
import { useLiveQuery } from '@tanstack/react-db';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { connectedSelector, serverIdSelector } from '../selectors';
import { ownUserIdSelector } from '../users/selectors';
import {
  ensureMessageWindow,
  getMessageCollection,
  getMessageDatabase,
  getMessageQueryClient,
  getMessageWindow,
  getMessageWindowRequestState,
  getThreadChannelId,
  jumpToMessage,
  loadMoreMessages,
  returnToPresent as restorePresent,
  type TMessageWindow,
  type TMessageWindowState
} from './database';
import {
  findMessageElement,
  highlightMessageElement,
  nextFrame,
  scrollToVirtualMessage,
  waitForMessageElement
} from './helpers';

const EMPTY_WINDOW_STATE: TMessageWindowState = {
  initialized: false,
  cursor: null,
  hasMore: true,
  detached: false
};

export const useMessagesByChannelId = (channelId: number) => {
  const currentStore = useStore();
  useStoreSelector(serverIdSelector);
  useStoreSelector(ownUserIdSelector);
  const collection = getMessageCollection(currentStore, channelId);
  return useLiveQuery({
    client: getMessageDatabase(currentStore),
    query: (q) =>
      q
        .from({ message: collection })
        .orderBy(({ message }) => message.createdAt, 'asc')
        .orderBy(({ message }) => message.id, 'asc')
  }).data;
};

const useMessageWindow = (kind: 'channel' | 'thread', id: number) => {
  const { t } = useTranslation('common');
  const reportError = useCallback(
    (error: unknown) => {
      if (
        isCancelledError(error) ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        return;
      logDebug('Message history request failed', error);
      toast.error(getTrpcError(error, t('errorLabel')));
    },
    [t]
  );
  const currentStore = useStore();
  const connected = useStoreSelector(connectedSelector);
  const serverId = useStoreSelector(serverIdSelector);
  const ownUserId = useStoreSelector(ownUserIdSelector);
  const threadChannelId = useStoreSelector(threadChannelIdSelector);
  const channelId =
    kind === 'channel'
      ? id
      : (getThreadChannelId(currentStore, id) ?? threadChannelId ?? 0);
  const window = getMessageWindow(
    currentStore,
    channelId,
    kind === 'thread' ? id : undefined
  );
  const queryClient = getMessageQueryClient(currentStore);
  const messages = useLiveQuery({
    client: getMessageDatabase(currentStore),
    query: (q) =>
      q
        .from({ message: window.collection })
        .orderBy(({ message }) => message.createdAt, 'asc')
        .orderBy(({ message }) => message.id, 'asc')
  }).data;
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.query.queryKey.length >= window.key.length &&
          window.key.every(
            (value, index) => event.query.queryKey[index] === value
          )
        )
          listener();
      }),
    [queryClient, window]
  );
  const metadata = useMemo(
    () =>
      new QueryObserver<TMessageWindowState>(queryClient, {
        queryKey: window.stateKey,
        enabled: false
      }),
    [queryClient, window]
  );
  const subscribeMetadata = useCallback(
    (listener: () => void) => metadata.subscribe(listener),
    [metadata]
  );
  const getSnapshot = useCallback(
    () => metadata.getCurrentResult().data ?? EMPTY_WINDOW_STATE,
    [metadata]
  );
  const page = useSyncExternalStore(
    subscribeMetadata,
    getSnapshot,
    getSnapshot
  );
  const getFetching = useCallback(
    () => queryClient.isFetching({ queryKey: window.key }) > 0,
    [queryClient, window]
  );
  const fetching = useSyncExternalStore(subscribe, getFetching, getFetching);
  useEffect(() => {
    if (connected) ensureMessageWindow(currentStore, window).catch(reportError);
  }, [currentStore, window, connected, serverId, ownUserId, reportError]);

  const loadMore = useCallback(async () => {
    try {
      await loadMoreMessages(currentStore, window);
    } catch (error) {
      reportError(error);
    }
  }, [currentStore, window, reportError]);

  return {
    currentStore,
    window,
    reportError,
    paginated: {
      fetching,
      loading: getMessageWindowRequestState(currentStore, window).loading,
      hasMore: page.hasMore,
      cursor: page.cursor,
      messages,
      loadMore,
      isEmpty: !messages.length && !fetching && page.initialized,
      detachedFromPresent: page.detached
    }
  };
};

export const useMessages = (channelId: number) => {
  const { currentStore, window, reportError, paginated } = useMessageWindow(
    'channel',
    channelId
  );
  const activeWindow = useRef<TMessageWindow | undefined>(window);
  activeWindow.current = window;
  useEffect(() => {
    activeWindow.current = window;
    return () => {
      activeWindow.current = undefined;
    };
  }, [window]);

  const scrollToMessage = useCallback(
    async (messageId: number, highlightTime = 4000) => {
      try {
        // a loaded message may be outside the virtual DOM; mount it before deciding to fetch
        const existing =
          (await scrollToVirtualMessage(channelId, messageId)) ??
          findMessageElement(messageId);
        if (activeWindow.current !== window) return;
        if (existing) {
          await highlightMessageElement(existing, highlightTime);
          return;
        }
        const applied = await jumpToMessage(currentStore, window, messageId);
        if (!applied || activeWindow.current !== window) return;
        await nextFrame();
        await nextFrame();
        if (activeWindow.current !== window) return;
        const element =
          (await scrollToVirtualMessage(channelId, messageId)) ??
          (await waitForMessageElement(messageId));
        if (element && activeWindow.current === window) {
          await highlightMessageElement(element, highlightTime);
        }
      } catch (error) {
        reportError(error);
      }
    },
    [currentStore, window, channelId, reportError]
  );

  const returnToPresent = useCallback(async () => {
    try {
      await restorePresent(currentStore, window);
    } catch (error) {
      reportError(error);
    }
  }, [currentStore, window, reportError]);

  return {
    ...paginated,
    scrollToMessage,
    returnToPresent
  };
};

export const useThreadMessagesByParentId = (parentMessageId: number) => {
  const currentStore = useStore();
  const sidebarChannelId = useStoreSelector(threadChannelIdSelector);
  const channelId =
    getThreadChannelId(currentStore, parentMessageId) ?? sidebarChannelId ?? 0;
  const collection = getMessageCollection(
    currentStore,
    channelId,
    parentMessageId
  );
  return useLiveQuery({
    client: getMessageDatabase(currentStore),
    query: (q) =>
      q
        .from({ message: collection })
        .orderBy(({ message }) => message.createdAt, 'asc')
        .orderBy(({ message }) => message.id, 'asc')
  }).data;
};

export const useThreadMessages = (parentMessageId: number) => {
  const { paginated } = useMessageWindow('thread', parentMessageId);
  return paginated;
};

export const useParentMessage = (
  messageId: number | undefined,
  channelId: number | undefined
) => {
  const currentStore = useStore();
  useStoreSelector(serverIdSelector);
  useStoreSelector(ownUserIdSelector);
  const collection = getMessageCollection(currentStore, channelId ?? 0);
  return useLiveQuery({
    client: getMessageDatabase(currentStore),
    query: (q) =>
      messageId !== undefined && channelId !== undefined
        ? q
            .from({ message: collection })
            .where(({ message }) => eq(message.id, messageId))
            .findOne()
        : undefined
  }).data;
};
