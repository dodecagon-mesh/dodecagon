import { threadSidebarDataSelector } from '@/features/app/selectors';
import type { IStore } from '@/features/store';
import { logDebug } from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import {
  DEFAULT_MESSAGES_LIMIT,
  type TJoinedMessage,
  type TMessagesCursor
} from '@dodecagon/shared';
import { collectionOptions, DbClient, type Collection } from '@tanstack/db';
import {
  isCancelledError,
  QueryClient,
  type InfiniteData,
  type QueryKey
} from '@tanstack/query-core';
import {
  createCursorPager,
  queryCollectionOptions,
  type CursorPage,
  type CursorPager,
  type QueryCollectionUtils
} from '@tanstack/query-db-collection';
import { TRPCClientError } from '@trpc/client';
import { mergeMessagesChronologically } from '../helpers';
import { canReadMessageChannel } from './navigation-intent';

export type TClientMessage = TJoinedMessage;
export type TMessageCollection = Collection<
  TClientMessage,
  number,
  QueryCollectionUtils<TClientMessage, number>
>;
type TPage = {
  messages: TJoinedMessage[];
  nextCursor: TMessagesCursor | null;
  hasNewer?: boolean;
};
type TOperation = 'refresh' | 'more' | 'jump' | 'present';
export type TMessageWindow = {
  channelId: number;
  parentMessageId?: number;
  key: QueryKey;
  rowsKey: QueryKey;
  stateKey: QueryKey;
  pagesKey: QueryKey;
  threadPager?: CursorPager<TJoinedMessage>;
  collection: TMessageCollection;
  initialized: boolean;
  cursor: TMessagesCursor | null;
  detached: boolean;
  uncertain: boolean;
  confirmedThrough: TMessagesCursor | null;
  revision: number;
  events: Map<number, number>;
  deletions: Map<number, number>;
  replyCounts: Map<number, { revision: number; count: number }>;
  cleanup?: Promise<void>;
};
type TScope = {
  identity: string;
  db: DbClient;
  queryClient: QueryClient;
  windows: Map<string, TMessageWindow>;
  removedUsers: Map<number, number | null>;
  disposed: boolean;
  unsubscribe: () => void;
  unsubscribeQueries?: () => void;
  cleanup?: Promise<void>;
};
export type TMessageWindowState = {
  initialized: boolean;
  cursor: TMessagesCursor | null;
  hasMore: boolean;
  detached: boolean;
};
const scopes = new WeakMap<IStore, TScope>();
const STALE_TIME = 30_000;
const GC_TIME = 5 * 60_000;
const MAX_WINDOWS = 12;
const MAX_INACTIVE_ROWS = 10_000;
const compare = (a: TMessagesCursor, b: TMessagesCursor) =>
  a.createdAt - b.createdAt || a.id - b.id;
const cursorOf = ({ id, createdAt }: TMessagesCursor): TMessagesCursor => ({
  id,
  createdAt
});
const getClientMessageKey = (message: TClientMessage) => message.id;
export const getMessageDatabaseScope = (currentStore: IStore) =>
  JSON.stringify([
    currentStore.getState().server.serverId ?? null,
    currentStore.getState().server.ownUserId ?? null
  ]);
const stateOf = (window: TMessageWindow): TMessageWindowState => ({
  initialized: window.initialized,
  cursor: window.cursor,
  hasMore: !window.initialized || window.cursor !== null,
  detached: window.detached
});
const publishState = (scope: TScope, window: TMessageWindow) =>
  scope.queryClient.setQueryData(window.stateKey, stateOf(window));
export const reportMessageDatabaseError = (error: unknown) => {
  if (
    isCancelledError(error) ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
    return;
  logDebug('Message database operation failed', error);
};
const assertCurrent = (
  currentStore: IStore,
  scope: TScope,
  signal?: AbortSignal
) => {
  if (
    scope.disposed ||
    scope.identity !== getMessageDatabaseScope(currentStore) ||
    signal?.aborted
  )
    throw new DOMException('Obsolete message request', 'AbortError');
};
const cleanupScope = (scope: TScope): Promise<void> => {
  if (scope.cleanup) return scope.cleanup;
  scope.disposed = true;
  scope.unsubscribe();
  scope.unsubscribeQueries?.();
  scope.cleanup = (async () => {
    try {
      await scope.queryClient.cancelQueries();
      // native adapters must detach observers before Query objects are removed.
      // otherwise observer teardown schedules GC on an already orphaned Query.
      await scope.db.cleanup();
    } finally {
      scope.queryClient.clear();
    }
  })();
  return scope.cleanup;
};
const resetWindow = (scope: TScope, window: TMessageWindow) => {
  window.initialized = false;
  window.cursor = null;
  window.detached = false;
  window.uncertain = false;
  window.confirmedThrough = null;
  window.events.clear();
  window.deletions.clear();
  window.replyCounts.clear();
  if (scope.queryClient.getQueryState(window.stateKey))
    publishState(scope, window);
};
const evictWindow = (scope: TScope, window: TMessageWindow) => {
  resetWindow(scope, window);
  window.cleanup = (async () => {
    try {
      await scope.queryClient.cancelQueries({ queryKey: window.key });
      await window.collection.cleanup();
    } finally {
      scope.queryClient.removeQueries({ queryKey: window.key });
    }
  })();
  window.cleanup.catch(reportMessageDatabaseError);
};
const prune = (currentStore: IStore, scope: TScope) => {
  let inactiveRows = 0;
  let cachedWindows = 0;
  for (const window of scope.windows.values()) {
    if (window.initialized || window.collection.size) cachedWindows++;
    if (!window.collection.subscriberCount)
      inactiveRows += window.collection.size;
  }
  for (const window of scope.windows.values()) {
    if (!window.initialized && !window.collection.size) continue;
    const unauthorized = !canReadMessageChannel(
      currentStore.getState(),
      window.channelId
    );
    if (
      unauthorized ||
      (!window.collection.subscriberCount &&
        !scope.queryClient.isFetching({ queryKey: window.key }) &&
        (cachedWindows > MAX_WINDOWS || inactiveRows > MAX_INACTIVE_ROWS))
    ) {
      inactiveRows -= window.collection.subscriberCount
        ? 0
        : window.collection.size;
      cachedWindows--;
      evictWindow(scope, window);
    }
  }
};
const scopeFor = (currentStore: IStore): TScope => {
  const identity = getMessageDatabaseScope(currentStore);
  const existing = scopes.get(currentStore);
  if (existing && existing.identity === identity && !existing.disposed)
    return existing;
  if (existing) cleanupScope(existing).catch(reportMessageDatabaseError);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false
      }
    }
  });
  const scope: TScope = {
    identity,
    queryClient,
    db: new DbClient({ queryClient }),
    windows: new Map(),
    removedUsers: new Map(),
    disposed: false,
    unsubscribe: () => {}
  };
  scopes.set(currentStore, scope);
  let previous = currentStore.getState().server;
  scope.unsubscribe = currentStore.subscribe(() => {
    const next = currentStore.getState().server;
    const before = previous;
    previous = next;
    if (getMessageDatabaseScope(currentStore) !== scope.identity) {
      cleanupScope(scope).catch(reportMessageDatabaseError);
      return;
    }
    if (before.connected && !next.connected) {
      for (const window of scope.windows.values()) {
        // only the last confirmed contiguous boundary survives a socket interruption.
        // a subsequently observed live row cannot prove the missed interval exists.
        window.uncertain = true;
        publishState(scope, window);
      }
      queryClient
        .cancelQueries({ queryKey: ['messages', identity] })
        .catch(reportMessageDatabaseError);
      queryClient
        .invalidateQueries({
          queryKey: ['messages', identity],
          refetchType: 'none'
        })
        .catch(reportMessageDatabaseError);
    }
    if (
      before.channels !== next.channels ||
      before.channelPermissions !== next.channelPermissions ||
      before.roles !== next.roles
    )
      prune(currentStore, scope);
  });
  // query removal invalidates domain metadata only. native collection lifecycle
  // already owns adapter teardown and may itself be emitting this removal.
  scope.unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
    if (scope.disposed) return;
    if (event.type !== 'removed') return;
    for (const window of scope.windows.values()) {
      if (
        event.query.queryKey === window.rowsKey &&
        !window.collection.subscriberCount
      ) {
        resetWindow(scope, window);
        queryClient.removeQueries({ queryKey: window.pagesKey });
      }
    }
  });
  return scope;
};
export const getMessageDatabase = (currentStore: IStore): DbClient =>
  scopeFor(currentStore).db;
export const getMessageQueryClient = (currentStore: IStore): QueryClient =>
  scopeFor(currentStore).queryClient;
export const disposeMessageDatabase = (currentStore: IStore): Promise<void> => {
  const scope = scopes.get(currentStore);
  return scope ? cleanupScope(scope) : Promise.resolve();
};

const readWindow = (window: TMessageWindow) =>
  [...window.collection.values()].sort(compare);
const applyUserRemoval = (scope: TScope, row: TClientMessage) => {
  const replacement =
    row.userId === null ? undefined : scope.removedUsers.get(row.userId);
  if (replacement === null) return undefined;
  const reactionsChanged = row.reactions?.some(
    (reaction) =>
      reaction.userId !== null && scope.removedUsers.has(reaction.userId)
  );
  if (replacement === undefined && !reactionsChanged) return row;
  return {
    ...row,
    userId: replacement ?? row.userId,
    reactions: reactionsChanged
      ? row.reactions.flatMap((reaction) => {
          const author =
            reaction.userId === null
              ? undefined
              : scope.removedUsers.get(reaction.userId);
          return author === null
            ? []
            : [{ ...reaction, userId: author ?? reaction.userId }];
        })
      : row.reactions
  };
};
type TMessagePages = InfiniteData<
  CursorPage<TJoinedMessage>,
  string | undefined
>;

const refreshRootRange = async (
  currentStore: IStore,
  scope: TScope,
  window: TMessageWindow,
  previousRows: TClientMessage[],
  signal: AbortSignal
): Promise<TClientMessage[]> => {
  const first = previousRows[0];
  const top = previousRows.at(-1);
  if (!first || !top) return [];
  const rangeKey = [
    ...window.pagesKey,
    'range',
    JSON.stringify([cursorOf(first), cursorOf(top)])
  ];
  const pager = createCursorPager<TJoinedMessage>({
    queryClient: scope.queryClient,
    queryKey: rangeKey,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    fetchPage: async (opaqueCursor, pageSignal) => {
      assertCurrent(currentStore, scope, pageSignal);
      const cursor: TMessagesCursor =
        opaqueCursor === undefined ? cursorOf(top) : JSON.parse(opaqueCursor);
      const trpc = getTRPCClient();
      const page = await trpc.messages.get.query(
        { channelId: window.channelId, cursor, limit: DEFAULT_MESSAGES_LIMIT },
        { signal: pageSignal }
      );
      assertCurrent(currentStore, scope, pageSignal);
      // the known reading interval is the authority boundary. a deletion may
      // shorten it; do not fill that hole by draining older, previously unseen rows.
      const rows = page.messages.filter((row) => compare(row, first) >= 0);
      const reachedFirst =
        page.messages.some((row) => compare(row, first) <= 0) ||
        (page.nextCursor !== null && compare(page.nextCursor, first) <= 0);
      return {
        rows,
        nextCursor:
          reachedFirst || page.nextCursor === null
            ? null
            : JSON.stringify(page.nextCursor)
      };
    }
  });
  await scope.queryClient.invalidateQueries({
    queryKey: rangeKey,
    exact: true,
    refetchType: 'none'
  });
  const [older, currentTop] = await Promise.all([
    pager.read(
      { offset: 0, limit: Math.max(0, previousRows.length - 1) },
      signal
    ),
    scope.queryClient.fetchQuery({
      queryKey: [...window.pagesKey, 'top', JSON.stringify(cursorOf(top))],
      staleTime: 0,
      queryFn: async ({ signal: topSignal }) => {
        assertCurrent(currentStore, scope, topSignal);
        const trpc = getTRPCClient();
        try {
          const row = await trpc.messages.getOne.query(
            { messageId: top.id },
            { signal: topSignal }
          );
          assertCurrent(currentStore, scope, topSignal);
          return row;
        } catch (error) {
          assertCurrent(currentStore, scope, topSignal);
          if (
            error instanceof TRPCClientError &&
            error.data?.code === 'NOT_FOUND'
          )
            return null;
          throw error;
        }
      }
    })
  ]).catch(async (error: unknown) => {
    await scope.queryClient.cancelQueries({ queryKey: window.pagesKey });
    throw error;
  });
  assertCurrent(currentStore, scope, signal);
  older.reverse();
  if (currentTop) older.push(currentTop);
  return older;
};

const fetchWindow = async (
  currentStore: IStore,
  scope: TScope,
  window: TMessageWindow,
  operation: TOperation,
  signal: AbortSignal,
  targetMessageId?: number
): Promise<TClientMessage[]> => {
  assertCurrent(currentStore, scope, signal);
  if (!canReadMessageChannel(currentStore.getState(), window.channelId))
    throw new Error('This conversation is not available.');
  const revision = window.revision;
  const initialized = window.initialized;
  const previousCursor = window.cursor;
  const detachedRefresh =
    operation === 'refresh' &&
    window.parentMessageId === undefined &&
    initialized &&
    window.detached;
  const confirmed = () =>
    readWindow(window).filter(
      (row) =>
        !window.uncertain ||
        (!!window.confirmedThrough &&
          compare(row, window.confirmedThrough) <= 0)
    );
  const before = confirmed();
  let raw: TPage;
  let refreshedRange: TClientMessage[] | undefined;
  if (detachedRefresh) {
    // revalidate the known reading interval, never a disjoint latest page.
    // the helper returns its complete authoritative interval in ascending order.
    raw = {
      messages: await refreshRootRange(
        currentStore,
        scope,
        window,
        before,
        signal
      ),
      nextCursor: previousCursor,
      hasNewer: true
    };
  } else if (window.threadPager) {
    const cached = scope.queryClient.getQueryData<TMessagePages>(
      window.pagesKey
    );
    const count =
      cached?.pages.reduce((total, page) => total + page.rows.length, 0) ?? 0;
    if (operation === 'refresh' && initialized) {
      await scope.queryClient.invalidateQueries({
        queryKey: window.pagesKey,
        exact: true,
        refetchType: 'none'
      });
    }
    // one requested row acquires one complete server page. on stale reads the
    // native pager replays only its already-loaded page prefix, from the start.
    await window.threadPager.read(
      { offset: 0, limit: operation === 'more' ? count + 1 : 1 },
      signal
    );
    const pages = scope.queryClient.getQueryData<TMessagePages>(
      window.pagesKey
    );
    if (!pages?.pages.length)
      throw new Error('Message page acquisition produced no result.');
    const next = pages.pages.at(-1)!.nextCursor;
    raw = {
      messages: pages.pages.flatMap((page) => [...page.rows]),
      nextCursor: next === null ? null : JSON.parse(next)
    };
  } else {
    const trpc = getTRPCClient();
    raw = await trpc.messages.get.query(
      {
        channelId: window.channelId,
        cursor: operation === 'more' ? previousCursor : null,
        targetMessageId,
        limit: DEFAULT_MESSAGES_LIMIT
      },
      { signal }
    );
    if (operation === 'refresh' && initialized && before.length) {
      refreshedRange = await refreshRootRange(
        currentStore,
        scope,
        window,
        before,
        signal
      );
    }
  }
  assertCurrent(currentStore, scope, signal);
  if (!canReadMessageChannel(currentStore.getState(), window.channelId))
    throw new DOMException('Conversation access changed', 'AbortError');
  const repair = (values: TClientMessage[]) =>
    values.flatMap((row) => {
      if ((window.deletions.get(row.id) ?? 0) > revision) return [];
      const edited =
        (window.events.get(row.id) ?? 0) > revision
          ? (window.collection.get(getClientMessageKey(row)) ?? row)
          : row;
      const admitted = applyUserRemoval(scope, edited);
      if (!admitted) return [];
      const updated =
        admitted.replyToMessageId &&
        (window.deletions.get(admitted.replyToMessageId) ?? 0) > revision
          ? { ...admitted, replyToMessageId: null, replyTo: null }
          : admitted;
      const count = window.replyCounts.get(row.id);
      return [
        count && count.revision > revision
          ? { ...updated, replyCount: count.count }
          : updated
      ];
    });
  const ordered =
    window.parentMessageId === undefined && !detachedRefresh
      ? [...raw.messages].reverse()
      : raw.messages;
  const current = confirmed();
  const rawIds = new Set(ordered.map((row) => row.id));
  const overlaps =
    before.some((row) => rawIds.has(row.id)) ||
    current.some((row) => rawIds.has(row.id));
  const disjoint =
    !detachedRefresh &&
    operation === 'refresh' &&
    window.parentMessageId === undefined &&
    initialized &&
    before.length > 0 &&
    ordered.length > 0 &&
    !overlaps;
  const incoming = repair(ordered);
  // a thread result is the complete native pager prefix, not a forward delta.
  // root refreshes retain their reading interval, but only after revalidating it.
  const merge =
    !detachedRefresh &&
    window.parentMessageId === undefined &&
    (operation === 'more' || (operation === 'refresh' && overlaps));
  const authoritativeCurrent =
    refreshedRange === undefined ? current : repair(refreshedRange);
  let rows = incoming;
  if (merge) {
    const first = ordered[0];
    const keep = authoritativeCurrent.filter((row) => {
      if (rawIds.has(row.id) || (window.deletions.get(row.id) ?? 0) > revision)
        return false;
      return operation === 'more' || !first || compare(row, first) < 0;
    });
    rows = mergeMessagesChronologically(keep, incoming);
  }
  const detached =
    disjoint || (operation === 'more' ? window.detached : !!raw.hasNewer);
  if (disjoint) rows = authoritativeCurrent;
  if (
    !detached &&
    (window.parentMessageId === undefined || raw.nextCursor === null)
  ) {
    const additions = readWindow(window).filter(
      (row) =>
        (window.events.get(row.id) ?? 0) > revision && !rawIds.has(row.id)
    );
    rows = mergeMessagesChronologically(rows, additions);
  }
  window.cursor =
    operation === 'refresh' &&
    window.parentMessageId === undefined &&
    initialized &&
    (overlaps || disjoint)
      ? previousCursor
      : raw.nextCursor;
  window.detached = detached;
  window.initialized = true;
  window.uncertain = disjoint || (operation === 'more' && window.uncertain);
  if (!disjoint) {
    const boundary = rows.at(-1);
    if (
      boundary &&
      (!merge ||
        !window.confirmedThrough ||
        compare(boundary, window.confirmedThrough) > 0)
    )
      window.confirmedThrough = cursorOf(boundary);
    else if (!merge && !boundary) window.confirmedThrough = null;
  }
  publishState(scope, window);
  // a direct write can race a page snapshot. revalidate that native page cache
  // on its next use rather than later replaying an older cached edit/delete.
  if (window.revision !== revision)
    scope.queryClient
      .invalidateQueries({ queryKey: window.pagesKey, refetchType: 'none' })
      .catch(reportMessageDatabaseError);
  window.events.clear();
  window.deletions.clear();
  window.replyCounts.clear();
  return rows;
};

export const getMessageWindow = (
  currentStore: IStore,
  channelId: number,
  parentMessageId?: number
): TMessageWindow => {
  const scope = scopeFor(currentStore);
  const id = `${channelId}:${parentMessageId ?? 'root'}`;
  const existing = scope.windows.get(id);
  if (existing) {
    scope.windows.delete(id);
    scope.windows.set(id, existing);
    if (!scope.queryClient.getQueryData(existing.stateKey))
      publishState(scope, existing);
    return existing;
  }
  const key = [
    'messages',
    scope.identity,
    channelId,
    parentMessageId ?? 'root'
  ];
  const rowsKey = [...key, 'rows'];
  const stateKey = [...key, 'window'];
  const pagesKey = [...key, 'pages'];
  const descriptor = collectionOptions(`messages:${scope.identity}:${id}`, () =>
    queryCollectionOptions({
      queryKey: rowsKey,
      queryClient: scope.queryClient,
      queryFn: ({ signal }): Promise<TClientMessage[]> =>
        fetchWindow(currentStore, scope, window, 'refresh', signal),
      getKey: getClientMessageKey,
      enabled: false,
      initialData: [] as TClientMessage[],
      initialDataUpdatedAt: 0,
      staleTime: STALE_TIME,
      gcTime: GC_TIME,
      retry: false,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false
    })
  );
  const window: TMessageWindow = {
    channelId,
    parentMessageId,
    key,
    rowsKey,
    stateKey,
    pagesKey,
    threadPager:
      parentMessageId === undefined
        ? undefined
        : createCursorPager<TJoinedMessage>({
            queryClient: scope.queryClient,
            queryKey: pagesKey,
            staleTime: STALE_TIME,
            // the row resource owns lifetime: its GC/eviction removes this page key.
            // a mounted reading window must not lose its loaded cursor prefix to TTL.
            gcTime: Infinity,
            fetchPage: async (opaqueCursor, signal) => {
              assertCurrent(currentStore, scope, signal);
              const cursor: TMessagesCursor | null =
                opaqueCursor === undefined ? null : JSON.parse(opaqueCursor);
              const trpc = getTRPCClient();
              const page = await trpc.messages.getThread.query(
                { parentMessageId, cursor, limit: DEFAULT_MESSAGES_LIMIT },
                { signal }
              );
              assertCurrent(currentStore, scope, signal);
              return {
                rows: page.messages,
                nextCursor:
                  page.nextCursor === null
                    ? null
                    : JSON.stringify(page.nextCursor)
              };
            }
          }),
    collection: scope.db.collection(descriptor),
    initialized: false,
    cursor: null,
    detached: false,
    uncertain: false,
    confirmedThrough: null,
    revision: 0,
    events: new Map(),
    deletions: new Map(),
    replyCounts: new Map()
  };
  scope.windows.set(id, window);
  publishState(scope, window);
  prune(currentStore, scope);
  return window;
};
export const getMessageCollection = (
  currentStore: IStore,
  channelId: number,
  parentMessageId?: number
): TMessageCollection =>
  getMessageWindow(currentStore, channelId, parentMessageId).collection;
export const readMessages = (
  currentStore: IStore,
  channelId: number,
  parentMessageId?: number
): TClientMessage[] =>
  readWindow(getMessageWindow(currentStore, channelId, parentMessageId));
const EMPTY_MESSAGES: TClientMessage[] = [];
export const readLoadedMessages = (
  currentStore: IStore,
  channelId: number,
  parentMessageId?: number
): TClientMessage[] => {
  const window = scopeFor(currentStore).windows.get(
    `${channelId}:${parentMessageId ?? 'root'}`
  );
  return window ? readWindow(window) : EMPTY_MESSAGES;
};
export const getThreadChannelId = (
  currentStore: IStore,
  parentMessageId: number
) => {
  const sidebar = threadSidebarDataSelector(currentStore.getState());
  if (
    sidebar.parentMessageId === parentMessageId &&
    sidebar.channelId !== undefined
  )
    return sidebar.channelId;
  for (const window of scopeFor(currentStore).windows.values()) {
    if (
      window.parentMessageId === parentMessageId ||
      (window.parentMessageId === undefined &&
        [...window.collection.values()].some(
          (row) => row.id === parentMessageId
        ))
    )
      return window.channelId;
  }
  return undefined;
};
export const ensureMessageWindow = async (
  currentStore: IStore,
  window: TMessageWindow
) => {
  const scope = scopeFor(currentStore);
  if (
    !currentStore.getState().server.connected ||
    !canReadMessageChannel(currentStore.getState(), window.channelId)
  )
    return false;
  if (window.cleanup) await window.cleanup;
  const preload = window.collection.preload();
  await Promise.all([
    preload,
    scope.queryClient.fetchQuery({
      queryKey: window.rowsKey,
      queryFn: ({ signal }) =>
        fetchWindow(currentStore, scope, window, 'refresh', signal),
      staleTime: window.initialized && !window.uncertain ? STALE_TIME : 0
    })
  ]);
  assertCurrent(currentStore, scope);
  prune(currentStore, scope);
  return true;
};
const operate = async (
  currentStore: IStore,
  window: TMessageWindow,
  operation: Exclude<TOperation, 'refresh'>,
  targetMessageId?: number
) => {
  const scope = scopeFor(currentStore);
  if (
    !currentStore.getState().server.connected ||
    !canReadMessageChannel(currentStore.getState(), window.channelId)
  )
    return false;
  // query owns transport cancellation and stale-result exclusion. navigation
  // supersedes pagination; duplicate pagination shares its native query key.
  await window.cleanup;
  if (operation !== 'more')
    await scope.queryClient.cancelQueries({ queryKey: window.key });
  else await ensureMessageWindow(currentStore, window);
  await window.collection.preload();
  await scope.queryClient.fetchQuery({
    queryKey: window.rowsKey,
    queryFn: ({ signal }) =>
      fetchWindow(
        currentStore,
        scope,
        window,
        operation,
        signal,
        targetMessageId
      ),
    staleTime: 0
  });
  assertCurrent(currentStore, scope);
  prune(currentStore, scope);
  return true;
};
export const loadMoreMessages = (
  currentStore: IStore,
  window: TMessageWindow
) =>
  !window.initialized
    ? ensureMessageWindow(currentStore, window)
    : window.cursor === null
      ? Promise.resolve(false)
      : operate(currentStore, window, 'more');
export const jumpToMessage = (
  currentStore: IStore,
  window: TMessageWindow,
  messageId: number
) => operate(currentStore, window, 'jump', messageId);
export const returnToPresent = (currentStore: IStore, window: TMessageWindow) =>
  operate(currentStore, window, 'present');
export const prefetchMessages = (currentStore: IStore, channelId: number) => {
  const scope = scopeFor(currentStore);
  const window = getMessageWindow(currentStore, channelId);
  if (
    scope.queryClient.isFetching({ queryKey: ['messages', scope.identity] }) >=
      2 &&
    !scope.queryClient.isFetching({ queryKey: window.key })
  )
    return Promise.resolve(false);
  return ensureMessageWindow(currentStore, window).catch(() => false);
};
const canAdmit = (
  window: TMessageWindow,
  message: TClientMessage,
  acquiringInitialWindow = false
) => {
  const existing = window.collection.has(getClientMessageKey(message));
  if (!window.initialized && !existing && !acquiringInitialWindow) return false;
  if (window.uncertain || window.detached)
    return (
      existing &&
      (!window.uncertain ||
        (!!window.confirmedThrough &&
          compare(message, window.confirmedThrough) <= 0))
    );
  return (
    window.parentMessageId === undefined ||
    !window.initialized ||
    window.cursor === null ||
    compare(message, window.cursor) <= 0
  );
};
export const isMessageInWindow = (
  currentStore: IStore,
  message: TJoinedMessage
) => {
  const scope = scopeFor(currentStore);
  const window = scope.windows.get(
    `${message.channelId}:${message.parentMessageId ?? 'root'}`
  );
  return (
    !!window &&
    window.initialized &&
    canAdmit(window, message) &&
    window.collection.has(getClientMessageKey(message))
  );
};
export const writeSyncedMessage = async (
  currentStore: IStore,
  message: TJoinedMessage,
  operation: 'new' | 'update' = 'new'
) => {
  if (!canReadMessageChannel(currentStore.getState(), message.channelId))
    return;
  const scope = scopeFor(currentStore);
  const window = getMessageWindow(
    currentStore,
    message.channelId,
    message.parentMessageId ?? undefined
  );
  if (
    operation === 'update' &&
    !window.collection.has(getClientMessageKey(message))
  )
    return;
  if (
    !window.initialized &&
    operation === 'new' &&
    message.clientRequestId &&
    message.userId === currentStore.getState().server.ownUserId &&
    !window.collection.has(getClientMessageKey(message))
  )
    return;
  if (
    !canAdmit(
      window,
      message,
      scope.queryClient.isFetching({ queryKey: window.rowsKey, exact: true }) >
        0
    )
  )
    return;
  await window.cleanup;
  await window.collection.preload();
  assertCurrent(currentStore, scope);
  if (
    operation === 'update' &&
    !window.collection.has(getClientMessageKey(message))
  )
    return;
  if (
    !canAdmit(
      window,
      message,
      scope.queryClient.isFetching({ queryKey: window.rowsKey, exact: true }) >
        0
    )
  )
    return;
  window.revision++;
  if (scope.queryClient.isFetching({ queryKey: window.key }))
    window.events.set(message.id, window.revision);
  const admitted = applyUserRemoval(scope, message);
  if (!admitted) return;
  await window.collection.utils.writeUpsert(admitted);
  await scope.queryClient.invalidateQueries({
    queryKey: window.pagesKey,
    refetchType: 'none'
  });
  if (
    !window.uncertain &&
    !window.detached &&
    (window.parentMessageId === undefined || window.cursor === null) &&
    (!window.confirmedThrough || compare(message, window.confirmedThrough) > 0)
  )
    window.confirmedThrough = cursorOf(message);
  prune(currentStore, scope);
};
export const deleteSyncedMessage = async (
  currentStore: IStore,
  channelId: number,
  messageId: number
) => {
  const scope = scopeFor(currentStore);
  for (const window of scope.windows.values()) {
    if (window.channelId !== channelId) continue;
    window.revision++;
    if (scope.queryClient.isFetching({ queryKey: window.key }))
      window.deletions.set(messageId, window.revision);
    if (window.collection.size)
      await window.collection.utils.writeBatch(() => {
        for (const [key, row] of window.collection.entries()) {
          if (row.id === messageId) window.collection.utils.writeDelete(key);
          else if (row.replyToMessageId === messageId)
            window.collection.utils.writeUpsert({
              ...row,
              replyToMessageId: null,
              replyTo: null
            });
        }
      });
    await scope.queryClient.invalidateQueries({
      queryKey: window.pagesKey,
      refetchType: 'none'
    });
  }
};
export const writeMessageReplyCount = async (
  currentStore: IStore,
  channelId: number,
  messageId: number,
  replyCount: number
) => {
  const scope = scopeFor(currentStore);
  const window = getMessageWindow(currentStore, channelId);
  window.revision++;
  if (scope.queryClient.isFetching({ queryKey: window.key }))
    window.replyCounts.set(messageId, {
      revision: window.revision,
      count: replyCount
    });
  const row = window.collection.get(messageId);
  if (row) await window.collection.utils.writeUpsert({ ...row, replyCount });
  await scope.queryClient.invalidateQueries({
    queryKey: window.pagesKey,
    refetchType: 'none'
  });
};
// complete authoritative window replacement is also the public hydration seam:
// fixtures/SSR supply fetched rows, never dispatch message entities into the UI store.
export const writeMessageWindow = async (
  currentStore: IStore,
  channelId: number,
  messages: TJoinedMessage[],
  detached = false,
  parentMessageId?: number,
  cursor: TMessagesCursor | null = null
) => {
  const scope = scopeFor(currentStore);
  const window = getMessageWindow(currentStore, channelId, parentMessageId);
  await window.cleanup;
  await window.collection.preload();
  await scope.queryClient.cancelQueries({ queryKey: window.key });
  window.initialized = true;
  window.cursor = cursor;
  window.detached = detached;
  window.uncertain = false;
  const rows = [...messages].sort(compare);
  window.confirmedThrough = rows.length ? cursorOf(rows.at(-1)!) : null;
  publishState(scope, window);
  scope.queryClient.setQueryData(window.rowsKey, rows);
};

export const getMessageWindowRequestState = (
  currentStore: IStore,
  window: TMessageWindow
) => {
  const query = scopeFor(currentStore).queryClient.getQueryState<
    TClientMessage[]
  >(window.rowsKey);
  const fetching = query?.fetchStatus === 'fetching';
  return {
    fetching,
    loading:
      !window.initialized &&
      !window.collection.size &&
      (fetching ||
        (query?.status !== 'error' && (query?.dataUpdateCount ?? 0) === 0)),
    error: query?.error ?? undefined
  };
};

export const reconcileUserMessages = async (
  currentStore: IStore,
  userId: number,
  replacementUserId?: number
) => {
  const scope = scopeFor(currentStore);
  scope.removedUsers.set(userId, replacementUserId ?? null);
  for (const window of scope.windows.values()) {
    if (!window.collection.size) continue;
    await window.cleanup;
    await window.collection.utils.writeBatch(() => {
      for (const [key, row] of window.collection.entries()) {
        const updated = applyUserRemoval(scope, row);
        if (updated === row) continue;
        if (!updated) window.collection.utils.writeDelete(key);
        if (updated) window.collection.utils.writeUpsert(updated);
      }
    });
  }
};
