// isolate transport mocks while consuming native DB delivery and message windows
import type { TOutgoingMessage } from '@/features/server/messages/delivery';
import {
  ChannelType,
  type TChannel,
  type TJoinedMessage
} from '@dodecagon/shared';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

const windowKind = process.argv[2];
const ordering = process.argv[3];
const parentMessageId = windowKind === 'partial-thread' ? 4 : undefined;
const actualResponse = Promise.withResolvers<TJoinedMessage>();
const laterResponse = Promise.withResolvers<TJoinedMessage>();
const getOneStarted = Promise.withResolvers<void>();
const sends: TOutgoingMessage[] = [];
const sounds: unknown[] = [];
const pageRequests: unknown[] = [];
let onNew: ((message: TJoinedMessage) => void) | undefined;
let onDelete:
  ((event: { channelId: number; messageId: number }) => void) | undefined;
const noSubscription = {
  subscribe: () => ({ unsubscribe: () => {} })
};
const message = (
  id: number,
  requestId: string | null = null
): TJoinedMessage => ({
  id,
  createdAt: id,
  updatedAt: null,
  channelId: 1,
  userId: 1,
  pluginId: null,
  parentMessageId: parentMessageId ?? null,
  replyToMessageId: null,
  clientRequestId: requestId,
  content: `<p>server-${id}</p>`,
  files: [],
  reactions: [],
  metadata: null,
  editable: true,
  pinned: false,
  pinnedAt: null,
  pinnedBy: null,
  editedAt: null,
  editedBy: null,
  replyTo: null,
  replyCount: 0
});
const trpc = {
  messages: {
    send: {
      mutate: async (input: TOutgoingMessage) => {
        sends.push(input);
        return sends.length === 1 ? 20 : 21;
      }
    },
    getOne: {
      query: ({ messageId }: { messageId: number }) => {
        getOneStarted.resolve();
        return messageId === 20
          ? actualResponse.promise
          : laterResponse.promise;
      }
    },
    get: {
      query: async (input: { targetMessageId?: number }) => {
        pageRequests.push(input);
        if (input.targetMessageId) {
          return {
            messages: [message(2), message(1)],
            nextCursor: { id: 1, createdAt: 1 },
            hasNewer: true
          };
        }
        return {
          messages: [message(20, sends[0]!.clientRequestId), message(19)],
          nextCursor: { id: 19, createdAt: 19 },
          hasNewer: false
        };
      }
    },
    getThread: {
      query: async (input: { cursor?: { id: number } | null }) => {
        pageRequests.push(input);
        if (!input.cursor) {
          return {
            messages: [message(11), message(12)],
            nextCursor: { id: 12, createdAt: 12 }
          };
        }
        assert.equal(input.cursor.id, 12);
        return {
          messages: [message(13), message(20, sends[0]!.clientRequestId)],
          nextCursor: null
        };
      }
    },
    onNew: {
      subscribe: (
        _input: unknown,
        handlers: { onData: (value: TJoinedMessage) => void }
      ) => {
        onNew = handlers.onData;
        return { unsubscribe: () => {} };
      }
    },
    onUpdate: noSubscription,
    onDelete: {
      subscribe: (
        _input: unknown,
        handlers: {
          onData: (event: { channelId: number; messageId: number }) => void;
        }
      ) => {
        onDelete = handlers.onData;
        return { unsubscribe: () => {} };
      }
    },
    onTyping: noSubscription,
    onThreadReplyCountUpdate: noSubscription
  }
};

// only unrelated side effects and the network transport are replaced.
mock.module('@/lib/trpc', () => ({ getTRPCClient: () => trpc }));
mock.module('@/helpers/sounds', () => ({
  playSound: (sound: unknown) => sounds.push(sound)
}));
mock.module('@/helpers/browser-logger', () => ({ logDebug: () => {} }));
mock.module('@/helpers/voice-debug', () => ({ pushVoiceDebugEvent: () => {} }));
mock.module('@/helpers/upload-file', () => ({
  uploadFile: () => {
    throw new Error('an acknowledged message must not upload again');
  }
}));
mock.module('@/features/server/actions', () => ({
  markChannelAsRead: () => {}
}));
mock.module('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
globalThis.document = { hidden: false } as Document;

// dynamic imports exercise the module boundary only after isolated transport mocks are installed.
const { store } = await import('@/features/store');
const { serverInitialState, serverSliceActions } =
  await import('@/features/server/slice');
const {
  getMessageWindow,
  ensureMessageWindow,
  jumpToMessage,
  loadMoreMessages,
  returnToPresent,
  readMessages,
  getMessageDatabaseScope,
  disposeMessageDatabase
} = await import('@/features/server/messages/database');
const { subscribeToMessages } =
  await import('@/features/server/messages/subscriptions');
const { enqueueMessage, getMessageDeliveryCollection, retryMessageDelivery } =
  await import('@/features/server/messages/delivery');
const { SoundType } = await import('@/features/server/types');
store.setState({
  server: {
    ...serverInitialState,
    serverId: 'delivery-test',
    connected: true,
    ownUserId: 1,
    selectedChannelId: 1,
    channels: [
      {
        id: 1,
        name: 'general',
        type: ChannelType.TEXT,
        private: false,
        isDm: false
      } as TChannel
    ]
  }
});
const window = getMessageWindow(store, 1, parentMessageId);
if (parentMessageId) await ensureMessageWindow(store, window);
else await jumpToMessage(store, window, 2);
const delivery = getMessageDeliveryCollection(store);
const pendingEntries = () =>
  Array.from(delivery.values())
    .filter(
      (entry) =>
        entry.conversation === JSON.stringify([1, parentMessageId ?? null])
    )
    .sort((a, b) => a.sequence - b.sequence);
const stopSubscriptions = subscribeToMessages();
const sourceFile = new File(['payload'], 'attachment.txt', {
  type: 'text/plain'
});
const attachment = {
  id: 'temporary-upload',
  originalName: sourceFile.name,
  md5: 'hash',
  size: sourceFile.size,
  path: '/temporary',
  extension: '.txt',
  userId: 1,
  sourceFile
};
assert.equal(
  enqueueMessage({
    channelId: 1,
    parentMessageId,
    message: '<p>original queued text</p>',
    files: [attachment]
  }),
  true
);
await getOneStarted.promise;
const scope = getMessageDatabaseScope(store);
const requestId = sends[0]!.clientRequestId;
const originalEntry = pendingEntries()[0]!;
const actual = message(20, requestId);
const tick = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};
assert.ok(onNew);
if (ordering === 'response-first') {
  actualResponse.resolve(actual);
  await tick();
  onNew(actual);
} else {
  onNew(actual);
  if (ordering === 'late-get-one-error')
    actualResponse.reject(new Error('getOne response lost'));
  else actualResponse.resolve(actual);
  await tick();
}
const entries = pendingEntries();
assert.equal(
  entries.length,
  1,
  'acknowledgement must stay visible outside the loaded page'
);
const confirmed = entries[0]!;
assert.equal(confirmed.status, 'confirmed');
assert.ok(confirmed.message);
assert.equal(confirmed.message.id, 20);
assert.equal(confirmed.message.content, '<p>server-20</p>');
assert.deepEqual(sounds, [SoundType.MESSAGE_SENT]);
const loaded = () => readMessages(store, 1, parentMessageId);
assert.deepEqual(
  loaded().map((item) => item.id),
  parentMessageId ? [11, 12] : [1, 2]
);
assert.equal(
  pageRequests.length,
  1,
  'acknowledgement must not fetch intervening pages or return to present'
);
assert.equal(retryMessageDelivery(scope, originalEntry.id), undefined);
assert.equal(sends.length, 1, 'an acknowledged send must never be retried');
if (ordering === 'delete-confirmed') {
  assert.ok(onDelete);
  onDelete({ channelId: 1, messageId: 20 });
  await tick();
  assert.equal(
    pendingEntries().length,
    0,
    'deletion removes an own confirmed row outside the contiguous window'
  );
  assert.deepEqual(
    loaded().map((row) => row.id),
    parentMessageId ? [11, 12] : [1, 2]
  );
  assert.equal(
    pageRequests.length,
    1,
    'deleting an overlay cannot fetch the gap'
  );
  assert.deepEqual(sounds, [SoundType.MESSAGE_SENT]);
} else {
  assert.equal(
    enqueueMessage({
      channelId: 1,
      parentMessageId,
      message: '<p>new draft sent next</p>',
      files: []
    }),
    true
  );
  await tick();
  const newer = pendingEntries()[1]!;
  assert.equal(newer.status, 'sending');
  assert.equal(newer.input.content, '<p>new draft sent next</p>');
  assert.equal(sends.length, 2);
  if (parentMessageId) await loadMoreMessages(store, window);
  else await returnToPresent(store, window);
  assert.deepEqual(
    loaded().map((item) => item.id),
    parentMessageId ? [11, 12, 13, 20] : [19, 20]
  );
  assert.equal(loaded().filter((item) => item.id === 20).length, 1);
  assert.deepEqual(pendingEntries(), [newer]);
  onNew(actual);
  assert.equal(loaded().filter((item) => item.id === 20).length, 1);
  assert.deepEqual(pendingEntries(), [newer]);
  assert.deepEqual(sounds, [SoundType.MESSAGE_SENT]);
}
stopSubscriptions();
store.dispatch(serverSliceActions.resetState());
await disposeMessageDatabase(store);
if (ordering !== 'delete-confirmed')
  laterResponse.reject(new Error('test teardown'));
await tick();
