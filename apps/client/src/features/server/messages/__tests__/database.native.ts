import { serverSliceActions } from '@/features/server/slice';
import { createStore, type IStore } from '@/features/store';
import * as transport from '@/lib/trpc';
import {
  ChannelType,
  type AppRouter,
  type TChannel,
  type TJoinedMessage,
  type TMessagesCursor
} from '@dodecagon/shared';
import { createTRPCProxyClient, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
  deleteSyncedMessage,
  disposeMessageDatabase,
  ensureMessageWindow,
  getMessageCollection,
  getMessageDatabase,
  getMessageQueryClient,
  getMessageWindow,
  getMessageWindowRequestState,
  jumpToMessage,
  loadMoreMessages,
  prefetchMessages,
  readMessages,
  reconcileUserMessages,
  returnToPresent,
  writeMessageReplyCount,
  writeMessageWindow,
  writeSyncedMessage
} from '../database';

type TPage = {
  messages: TJoinedMessage[];
  nextCursor: TMessagesCursor | null;
  hasNewer?: boolean;
};
type TInput = { cursor?: TMessagesCursor | null; targetMessageId?: number };
const requests: {
  input: TInput;
  thread: boolean;
  result: {
    promise: Promise<TPage>;
    resolve: (page: TPage) => void;
    reject: (reason?: unknown) => void;
  };
}[] = [];
let requestAdded = Promise.withResolvers<void>();
const readbacks = new Map<number, TJoinedMessage | null | Error>();
const readbackRequests: number[] = [];
const client = createTRPCProxyClient<AppRouter>({
  links: [
    () =>
      ({ op }) =>
        observable((observer) => {
          if (op.path === 'messages.getOne') {
            const { messageId } = op.input as { messageId: number };
            readbackRequests.push(messageId);
            const row = readbacks.has(messageId)
              ? readbacks.get(messageId)
              : message(messageId);
            if (row instanceof Error) observer.error(TRPCClientError.from(row));
            else if (row) observer.next({ result: { data: row } });
            else
              observer.error(
                TRPCClientError.from({
                  error: {
                    code: -32004,
                    message: 'Message not found',
                    data: { code: 'NOT_FOUND' }
                  }
                })
              );
            observer.complete();
            return;
          }
          const result = Promise.withResolvers<TPage>();
          requests.push({
            input: op.input as TInput,
            thread: op.path === 'messages.getThread',
            result
          });
          requestAdded.resolve();
          requestAdded = Promise.withResolvers<void>();
          // The transport deliberately ignores unsubscribe/AbortSignal to prove the
          // native Query cancellation boundary rejects stale late responses.
          result.promise.then(
            (data) => {
              observer.next({ result: { data } });
              observer.complete();
            },
            (error: Error) => observer.error(TRPCClientError.from(error))
          );
        })
  ]
});
const stores: IStore[] = [];
const setup = () => {
  requests.length = 0;
  readbacks.clear();
  readbackRequests.length = 0;
  spyOn(transport, 'getTRPCClient').mockReturnValue(client);
  const store = createStore();
  store.setState({
    server: {
      ...store.getState().server,
      connected: true,
      serverId: 'server',
      ownUserId: 1,
      channels: [{ id: 1, private: false, type: ChannelType.TEXT } as TChannel]
    }
  });
  stores.push(store);
  return store;
};
const message = (
  id: number,
  parentMessageId: number | null = null
): TJoinedMessage =>
  ({
    id,
    channelId: 1,
    createdAt: id,
    userId: 1,
    content: `message-${id}`,
    parentMessageId
  }) as TJoinedMessage;
const respond = async (
  index: number,
  ids: number[],
  cursor: number | null = null,
  parent: number | null = null,
  hasNewer = false
) => {
  requests[index]!.result.resolve({
    messages: ids.map((id) => message(id, parent)),
    nextCursor: cursor === null ? null : { id: cursor, createdAt: cursor },
    hasNewer
  });
};
const waitForRequests = async (count: number) => {
  while (requests.length < count) await requestAdded.promise;
  expect(requests.length).toBe(count);
};
afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.dispatch(serverSliceActions.resetState());
    await disposeMessageDatabase(store);
  }
  spyOn(transport, 'getTRPCClient').mockRestore();
});

describe('native message database boundaries', () => {
  test('shares prefetch/open freshness and retains the oldest root cursor on overlap', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const first = ensureMessageWindow(store, window);
    const shared = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [5, 4], 4);
    await Promise.all([first, shared]);
    await ensureMessageWindow(store, window);
    expect(requests.length).toBe(1);
    const more = loadMoreMessages(store, window);
    await waitForRequests(2);
    expect(requests[1]!.input.cursor).toEqual({ id: 4, createdAt: 4 });
    await respond(1, [3, 2], 2);
    await more;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([2, 3, 4, 5]);
    expect(window.cursor).toEqual({ id: 2, createdAt: 2 });
  });
  test('reconnect live 101 cannot bridge an old root window to latest', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const initial = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [2, 1], 1);
    await initial;
    store.dispatch(serverSliceActions.setConnected(false));
    await writeSyncedMessage(store, message(101));
    store.dispatch(serverSliceActions.setConnected(true));
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(2);
    await respond(1, [101, 100], 100);
    await waitForRequests(3);
    expect(requests[2]!.input.cursor).toEqual({ id: 2, createdAt: 2 });
    await respond(2, [1]);
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([1, 2]);
    expect(window.detached).toBe(true);
    const present = returnToPresent(store, window);
    await waitForRequests(4);
    await respond(3, [101, 100], 100);
    await present;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([100, 101]);
  });
  test('thread reconnect revalidates the earliest loaded prefix despite live 13', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1, 90);
    const initial = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [9, 10], null, 90);
    await initial;
    store.dispatch(serverSliceActions.setConnected(false));
    await writeSyncedMessage(store, message(13, 90));
    store.dispatch(serverSliceActions.setConnected(true));
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(2);
    expect(requests[1]!.input.cursor).toBeNull();
    await respond(1, [9, 10, 11, 12, 13], null, 90);
    await refresh;
    expect(readMessages(store, 1, 90).map((row) => row.id)).toEqual([
      9, 10, 11, 12, 13
    ]);
  });
  test('late old-scope transport cannot populate a new account database', async () => {
    const store = setup();
    const oldDb = getMessageDatabase(store);
    const oldWindow = getMessageWindow(store, 1);
    const oldRequest = ensureMessageWindow(store, oldWindow).catch(
      () => undefined
    );
    await waitForRequests(1);
    store.setState({ server: { ...store.getState().server, ownUserId: 2 } });
    const nextDb = getMessageDatabase(store);
    expect(nextDb).not.toBe(oldDb);
    const next = ensureMessageWindow(store, getMessageWindow(store, 1));
    await waitForRequests(2);
    await respond(1, [20]);
    await next;
    await respond(0, [1]);
    await oldRequest;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([20]);
  });
  test('racing realtime edits/deletes/counts win over an older authoritative page', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const initial = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await writeSyncedMessage(store, { ...message(2), content: 'edited' });
    await deleteSyncedMessage(store, 1, 1);
    await writeMessageReplyCount(store, 1, 2, 7);
    await respond(0, [2, 1]);
    await initial;
    expect(
      readMessages(store, 1).map((row) => [row.id, row.content, row.replyCount])
    ).toEqual([[2, 'edited', 7]]);
  });
  test('detached own acknowledgement stays outside the contiguous query collection', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const jump = jumpToMessage(store, window, 2);
    await waitForRequests(1);
    await respond(0, [2, 1], 1, null, true);
    await jump;
    await writeSyncedMessage(store, message(100));
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([1, 2]);
    expect(getMessageCollection(store, 1).size).toBe(2);
  });
  test('separate stores never share message rows', async () => {
    const store = setup();
    const second = createStore();
    second.setState(store.getState());
    stores.push(second);
    const row = { ...message(1), clientRequestId: 'same' };
    await writeMessageWindow(store, 1, [row]);
    expect(readMessages(second, 1)).toEqual([]);
  });
  test('overlapping native stale refresh keeps loaded root history and its oldest cursor', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(2), message(3), message(4), message(5)],
      false,
      undefined,
      { id: 2, createdAt: 2 }
    );
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.rowsKey,
      refetchType: 'none'
    });
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [6, 5], 5);
    await waitForRequests(2);
    expect(requests[1]!.input.cursor).toEqual({ id: 5, createdAt: 5 });
    await respond(1, [4, 3, 2], 2);
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([
      2, 3, 4, 5, 6
    ]);
    expect(window.cursor).toEqual({ id: 2, createdAt: 2 });
  });
  test('native failure preserves cached UI and never starts an automatic retry', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(store, 1, [message(2), message(3)]);
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.rowsKey,
      refetchType: 'none'
    });
    const failed = ensureMessageWindow(store, window);
    const observed = failed.catch((error: unknown) => error);
    await waitForRequests(1);
    requests[0]!.result.reject(new Error('offline'));
    expect(await observed).toMatchObject({ message: 'offline' });
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([2, 3]);
    expect(requests.length).toBe(1);
    const retry = ensureMessageWindow(store, window);
    await waitForRequests(2);
    await respond(1, [4, 3]);
    await waitForRequests(3);
    await respond(2, [2]);
    await retry;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([2, 3, 4]);
  });
  test('a superseded pagination response cannot replace a newer detached jump', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(80), message(81)],
      false,
      undefined,
      { id: 80, createdAt: 80 }
    );
    const more = loadMoreMessages(store, window).catch(() => undefined);
    await waitForRequests(1);
    const jump = jumpToMessage(store, window, 20);
    await waitForRequests(2);
    await respond(1, [20, 19], 19, null, true);
    await jump;
    await respond(0, [79, 78], 78);
    await more;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([19, 20]);
    expect(window.detached).toBe(true);
  });
  test('uninitialized outgoing acknowledgements are not duplicated in a window without proven continuity', async () => {
    const store = setup();
    await writeSyncedMessage(store, {
      ...message(101),
      clientRequestId: 'outgoing'
    });
    expect(getMessageCollection(store, 1).size).toBe(0);
    await writeSyncedMessage(store, {
      ...message(102, 90),
      clientRequestId: 'thread-outgoing'
    });
    expect(getMessageCollection(store, 1, 90).size).toBe(0);
  });
  test('authorized intent prefetch admits only two in-flight conversations', async () => {
    const store = setup();
    store.setState({
      server: {
        ...store.getState().server,
        channels: [1, 2, 3].map(
          (id) => ({ id, private: false, type: ChannelType.TEXT }) as TChannel
        )
      }
    });
    const first = prefetchMessages(store, 1);
    const second = prefetchMessages(store, 2);
    await waitForRequests(2);
    expect(await prefetchMessages(store, 3)).toBe(false);
    expect(requests.length).toBe(2);
    await respond(0, [2, 1]);
    await respond(1, [3]);
    await Promise.all([first, second]);
  });
  test('bounded inactive windows can reopen their original native collection after eviction', async () => {
    const store = setup();
    store.setState({
      server: {
        ...store.getState().server,
        channels: Array.from(
          { length: 13 },
          (_, index) =>
            ({
              id: index + 1,
              private: false,
              type: ChannelType.TEXT
            }) as TChannel
        )
      }
    });
    const original = getMessageCollection(store, 1);
    for (let channelId = 1; channelId <= 13; channelId++) {
      const loading = ensureMessageWindow(
        store,
        getMessageWindow(store, channelId)
      );
      await waitForRequests(channelId);
      await respond(channelId - 1, [channelId]);
      await loading;
    }
    await getMessageWindow(store, 1).cleanup;
    expect(original.size).toBe(0);
    const reopening = ensureMessageWindow(store, getMessageWindow(store, 1));
    await waitForRequests(14);
    await respond(13, [100]);
    await reopening;
    expect(getMessageCollection(store, 1)).toBe(original);
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([100]);
  });
  test('user wipe and reassignment update native root and thread authors', async () => {
    const store = setup();
    await writeMessageWindow(store, 1, [
      {
        ...message(1),
        clientRequestId: 'author',
        reactions: [{ userId: 2, emoji: 'x' }] as TJoinedMessage['reactions']
      },
      { ...message(2), userId: 2, reactions: [] }
    ]);
    await writeMessageWindow(
      store,
      1,
      [{ ...message(3, 90), userId: 2, reactions: [] }],
      false,
      90
    );
    await reconcileUserMessages(store, 2);
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([1]);
    expect(readMessages(store, 1)[0]!.reactions).toEqual([]);
    expect(readMessages(store, 1, 90)).toEqual([]);
    await reconcileUserMessages(store, 1, 9);
    expect(readMessages(store, 1).map((row) => [row.id, row.userId])).toEqual([
      [1, 9]
    ]);
  });
  test('author reassignment preserves distinct server messages with the same client receipt', async () => {
    const store = setup();
    const clientRequestId = '00000000-0000-4000-8000-000000000001';
    await writeMessageWindow(store, 1, [
      { ...message(1), clientRequestId },
      { ...message(2), userId: 2, clientRequestId }
    ]);
    await reconcileUserMessages(store, 1, 2);
    expect(readMessages(store, 1).map((row) => [row.id, row.userId])).toEqual([
      [1, 2],
      [2, 2]
    ]);
  });
  test('cold initial fetch keeps another user nonce-bearing arrival without admitting own acknowledgement', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const initial = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await writeSyncedMessage(store, {
      ...message(6),
      userId: 2,
      clientRequestId: 'other-arrival'
    });
    await writeSyncedMessage(store, {
      ...message(7),
      clientRequestId: 'own-arrival'
    });
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([6]);
    await respond(0, [5, 4], 4);
    await initial;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([4, 5, 6]);
  });
  test('thread prefix revalidation repairs missed old edits and deletes without consuming its next page', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1, 90);
    const initial = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [1, 2], 2, 90);
    await initial;
    const more = loadMoreMessages(store, window);
    await waitForRequests(2);
    await respond(1, [3, 4], 4, 90);
    await more;
    store.dispatch(serverSliceActions.setConnected(false));
    store.dispatch(serverSliceActions.setConnected(true));
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(3);
    expect(requests[2]!.input.cursor).toBeNull();
    requests[2]!.result.resolve({
      messages: [
        { ...message(1, 90), content: 'edited while offline', replyCount: 8 },
        message(3, 90)
      ],
      nextCursor: { id: 3, createdAt: 3 }
    });
    await waitForRequests(4);
    expect(readMessages(store, 1, 90).map((row) => row.id)).toEqual([
      1, 2, 3, 4
    ]);
    expect(requests[3]!.input.cursor).toEqual({ id: 3, createdAt: 3 });
    await respond(3, [4, 5], 5, 90);
    await refresh;
    expect(readMessages(store, 1, 90).map((row) => row.id)).toEqual([
      1, 3, 4, 5
    ]);
    expect(readMessages(store, 1, 90)[0]).toMatchObject({
      content: 'edited while offline',
      replyCount: 8
    });
    expect(window.cursor).toEqual({ id: 5, createdAt: 5 });
    expect(requests.length).toBe(4);
  });
  test('root bounded old-range refresh repairs missed edits/deletes outside the latest page', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [1, 2, 3, 4, 5, 6].map((id) => message(id)),
      false,
      undefined,
      { id: 1, createdAt: 1 }
    );
    store.dispatch(serverSliceActions.setConnected(false));
    store.dispatch(serverSliceActions.setConnected(true));
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [8, 7, 6, 5], 5);
    await waitForRequests(2);
    expect(requests[1]!.input.cursor).toEqual({ id: 6, createdAt: 6 });
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([
      1, 2, 3, 4, 5, 6
    ]);
    requests[1]!.result.resolve({
      messages: [
        message(5),
        message(4),
        { ...message(3), content: 'old root edited offline', replyCount: 9 },
        message(1)
      ],
      nextCursor: { id: 1, createdAt: 1 }
    });
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([
      1, 3, 4, 5, 6, 7, 8
    ]);
    expect(readMessages(store, 1).find((row) => row.id === 3)).toMatchObject({
      content: 'old root edited offline',
      replyCount: 9
    });
    expect(window.cursor).toEqual({ id: 1, createdAt: 1 });
    expect(requests.length).toBe(2);
  });
  test('native initial query errors stop loading and a later retry owns its own loading state', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const initial = ensureMessageWindow(store, window);
    const firstError = initial.catch((error: unknown) => error);
    await waitForRequests(1);
    expect(getMessageWindowRequestState(store, window).loading).toBe(true);
    requests[0]!.result.reject(new Error('offline'));
    expect(await firstError).toMatchObject({ message: 'offline' });
    expect(window.initialized).toBe(false);
    expect(getMessageWindowRequestState(store, window)).toMatchObject({
      loading: false,
      fetching: false
    });
    const retry = ensureMessageWindow(store, window);
    await waitForRequests(2);
    expect(getMessageWindowRequestState(store, window).loading).toBe(true);
    await respond(1, []);
    await retry;
    expect(getMessageWindowRequestState(store, window)).toMatchObject({
      loading: false,
      fetching: false
    });
  });
  test('root old-range revalidation stops at its original lower boundary after deletion', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [3, 4, 5].map((id) => message(id)),
      false,
      undefined,
      { id: 3, createdAt: 3 }
    );
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.key,
      refetchType: 'none'
    });
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [7, 6, 5], 5);
    await waitForRequests(2);
    await respond(1, [4, 2, 1], 1);
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([4, 5, 6, 7]);
    expect(window.cursor).toEqual({ id: 3, createdAt: 3 });
    expect(requests.length).toBe(2);
  });
  test('root revalidation removes an old top only on authoritative NOT_FOUND', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(1), message(2)],
      false,
      undefined,
      { id: 1, createdAt: 1 }
    );
    readbacks.set(2, null);
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.key,
      refetchType: 'none'
    });
    const refresh = ensureMessageWindow(store, window);
    await waitForRequests(1);
    await respond(0, [4, 3], 3);
    await waitForRequests(2);
    await respond(1, [1]);
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([1]);
    expect(window.detached).toBe(true);
  });
  test('root readback failures other than NOT_FOUND retain cached rows and propagate', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(1), message(2)],
      false,
      undefined,
      { id: 1, createdAt: 1 }
    );
    readbacks.set(2, new Error('lookup forbidden'));
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.key,
      refetchType: 'none'
    });
    const refresh = ensureMessageWindow(store, window);
    const rejected = refresh.catch((error: unknown) => error);
    await waitForRequests(1);
    await respond(0, [4, 3], 3);
    await waitForRequests(2);
    await respond(1, [1]);
    expect(await rejected).toMatchObject({ message: 'lookup forbidden' });
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([1, 2]);
  });
  test('scope disposal shares one native cleanup promise and clears queries after adapter teardown', async () => {
    const store = setup();
    const queryClient = getMessageQueryClient(store);
    const collection = getMessageCollection(store, 1);
    await writeMessageWindow(store, 1, [message(1)]);
    const lifecycle: string[] = [];
    const stop = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'observerRemoved') lifecycle.push('observerRemoved');
      if (event.type === 'removed') lifecycle.push('removed');
    });
    store.dispatch(serverSliceActions.resetState());
    const first = disposeMessageDatabase(store);
    const second = disposeMessageDatabase(store);
    expect(second).toBe(first);
    await first;
    expect(collection.status).toBe('cleaned-up');
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(lifecycle.indexOf('observerRemoved')).toBeGreaterThanOrEqual(0);
    expect(lifecycle.indexOf('removed')).toBeGreaterThan(
      lifecycle.indexOf('observerRemoved')
    );
    stop();
  });
  test('query-cache removal never resurrects metadata after native adapters detach', async () => {
    const store = setup();
    const queryClient = getMessageQueryClient(store);
    const window = getMessageWindow(store, 1);
    const collection = window.collection;
    await writeMessageWindow(store, 1, [message(1)]);
    await collection.cleanup();
    // Model Query-owned row expiry without clearing a live adapter's observer:
    // removing its observer after raw clear is the orphan-GC timer defect.
    queryClient.setQueryData(window.rowsKey, []);
    queryClient.clear();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    await disposeMessageDatabase(store);
    expect(collection.status).toBe('cleaned-up');
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
  test('unviewed foreign, legacy, plugin and update streams cannot populate an uninitialized collection', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeSyncedMessage(store, {
      ...message(1),
      userId: 2,
      clientRequestId: 'foreign'
    });
    await writeSyncedMessage(store, {
      ...message(2),
      userId: 2,
      clientRequestId: null
    });
    await writeSyncedMessage(store, {
      ...message(3),
      userId: null,
      clientRequestId: null
    });
    await writeSyncedMessage(
      store,
      { ...message(4), userId: 2, content: 'unseen update' },
      'update'
    );
    await deleteSyncedMessage(store, 1, 99);
    expect(window.collection.size).toBe(0);
    expect(
      getMessageQueryClient(store).getQueryState(window.rowsKey)
    ).toBeUndefined();
    expect(requests).toEqual([]);
  });
  test('unknown historical updates cannot splice a gap into a loaded root window while loaded edits still apply', async () => {
    const store = setup();
    const ids = Array.from({ length: 50 }, (_, index) => 951 + index);
    await writeMessageWindow(
      store,
      1,
      ids.map((id) => message(id)),
      false,
      undefined,
      { id: 951, createdAt: 951 }
    );
    await writeSyncedMessage(
      store,
      {
        ...message(50),
        userId: 2,
        content: 'historical edit outside this window'
      },
      'update'
    );
    expect(readMessages(store, 1).map((row) => row.id)).toEqual(ids);
    await writeSyncedMessage(
      store,
      { ...message(980), content: 'loaded edit', replyCount: 7 },
      'update'
    );
    expect(readMessages(store, 1).find((row) => row.id === 980)).toMatchObject({
      content: 'loaded edit',
      replyCount: 7
    });
    expect(readMessages(store, 1).map((row) => row.id)).toEqual(ids);
    expect(requests).toEqual([]);
  });
  test('cold acquisition ignores unknown updates while journaling foreign new arrivals', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    const initial = ensureMessageWindow(store, window).catch(
      (error: unknown) => error
    );
    await waitForRequests(1);
    await writeSyncedMessage(
      store,
      { ...message(2), userId: 2, content: 'unloaded edit' },
      'update'
    );
    expect(window.collection.has(2)).toBe(false);
    await writeSyncedMessage(
      store,
      { ...message(6), userId: 2, clientRequestId: 'foreign-new' },
      'new'
    );
    await respond(0, [5, 4], 4);
    expect(await initial).toBe(true);
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([4, 5, 6]);
  });
  test('stale detached refresh revalidates only its anchored range while preserving warm cache and old cursor', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(3), message(4), message(5)],
      true,
      undefined,
      { id: 3, createdAt: 3 }
    );
    await ensureMessageWindow(store, window);
    expect(requests).toEqual([]);
    expect(readbackRequests).toEqual([]);
    readbacks.set(5, { ...message(5), content: 'detached top edited' });
    await getMessageQueryClient(store).invalidateQueries({
      queryKey: window.key,
      refetchType: 'none'
    });
    const refresh = ensureMessageWindow(store, window);
    const acquired = await Promise.race([
      requestAdded.promise.then(() => true),
      refresh.then(() => false)
    ]);
    expect(acquired).toBe(true);
    await waitForRequests(1);
    expect(requests[0]!.input).toMatchObject({
      cursor: { id: 5, createdAt: 5 }
    });
    expect(requests[0]!.input.targetMessageId).toBeUndefined();
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([3, 4, 5]);
    requests[0]!.result.resolve({
      messages: [
        { ...message(4), content: 'detached middle edited', replyCount: 9 },
        message(2)
      ],
      nextCursor: { id: 2, createdAt: 2 }
    });
    await refresh;
    expect(readMessages(store, 1).map((row) => row.id)).toEqual([4, 5]);
    expect(readMessages(store, 1)[0]).toMatchObject({
      content: 'detached middle edited',
      replyCount: 9
    });
    expect(readMessages(store, 1)[1]).toMatchObject({
      content: 'detached top edited'
    });
    expect(window.detached).toBe(true);
    expect(window.cursor).toEqual({ id: 3, createdAt: 3 });
    expect(requests.length).toBe(1);
    expect(readbackRequests).toEqual([5]);
  });
  test('detached reconnect repairs missed edits and deletions without fetching latest or returning to present', async () => {
    const store = setup();
    const window = getMessageWindow(store, 1);
    await writeMessageWindow(
      store,
      1,
      [message(30), message(31), message(32)],
      true,
      undefined,
      { id: 30, createdAt: 30 }
    );
    store.dispatch(serverSliceActions.setConnected(false));
    await writeSyncedMessage(store, {
      ...message(999),
      userId: 2,
      clientRequestId: 'outside-detached'
    });
    readbacks.set(32, null);
    store.dispatch(serverSliceActions.setConnected(true));
    const refresh = ensureMessageWindow(store, window);
    const acquired = await Promise.race([
      requestAdded.promise.then(() => true),
      refresh.then(() => false)
    ]);
    expect(acquired).toBe(true);
    await waitForRequests(1);
    expect(requests[0]!.input.cursor).toEqual({ id: 32, createdAt: 32 });
    expect(requests[0]!.input.targetMessageId).toBeUndefined();
    requests[0]!.result.resolve({
      messages: [
        { ...message(30), content: 'edited while detached offline' },
        message(29)
      ],
      nextCursor: { id: 29, createdAt: 29 }
    });
    await refresh;
    expect(readMessages(store, 1)).toMatchObject([
      { id: 30, content: 'edited while detached offline' }
    ]);
    expect(window.detached).toBe(true);
    expect(window.uncertain).toBe(false);
    expect(window.cursor).toEqual({ id: 30, createdAt: 30 });
    expect(requests.length).toBe(1);
    expect(readbackRequests).toEqual([32]);
  });
});
