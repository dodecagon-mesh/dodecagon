import type { TOutgoingMessage } from '@/features/server/messages/delivery';
import {
  ChannelType,
  type TChannel,
  type TJoinedMessage
} from '@dodecagon/shared';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

const bStarted = Promise.withResolvers<void>();
const bCommit = Promise.withResolvers<number>();
const calls: TOutgoingMessage[] = [];
const sounds: unknown[] = [];
const actual = (input: TOutgoingMessage, id: number): TJoinedMessage => ({
  id,
  channelId: input.channelId,
  userId: 1,
  createdAt: id,
  updatedAt: null,
  pluginId: null,
  parentMessageId: null,
  replyToMessageId: null,
  clientRequestId: input.clientRequestId,
  content: input.content,
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
        calls.push(input);
        if (input.content === '<p>A</p>') throw new Error('A response lost');
        if (input.content === '<p>B</p>') {
          bStarted.resolve();
          return bCommit.promise;
        }
        assert.equal(input.content, '<p>C</p>');
        return 3;
      }
    },
    getOne: {
      query: async ({ messageId }: { messageId: number }) => {
        const input = calls.find(
          (call) => call.content === (messageId === 2 ? '<p>B</p>' : '<p>C</p>')
        );
        assert.ok(input);
        return actual(input, messageId);
      }
    },
    get: {
      query: async () => ({ messages: [], nextCursor: null, hasNewer: false })
    },
    getThread: { query: async () => ({ messages: [], nextCursor: null }) }
  }
};
mock.module('@/lib/trpc', () => ({ getTRPCClient: () => trpc }));
mock.module('@/helpers/sounds', () => ({
  playSound: (sound: unknown) => sounds.push(sound)
}));
mock.module('@/helpers/browser-logger', () => ({ logDebug: () => {} }));
mock.module('@/helpers/voice-debug', () => ({ pushVoiceDebugEvent: () => {} }));
mock.module('@/features/server/actions', () => ({
  markChannelAsRead: () => {}
}));
mock.module('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
mock.module('@/helpers/upload-file', () => ({
  uploadFile: () => {
    throw new Error('this send contains no attachments');
  }
}));
// transport mocks load before production modules; collections, projections, actions and rollback stay native
const { store } = await import('@/features/store');
const { serverInitialState, serverSliceActions } =
  await import('@/features/server/slice');
const { getMessageDatabaseScope, disposeMessageDatabase } =
  await import('@/features/server/messages/database');
const {
  enqueueMessage,
  getMessageDeliveryCollection,
  retryMessageDelivery,
  reconcileMessageDelivery
} = await import('@/features/server/messages/delivery');
store.setState({
  server: {
    ...serverInitialState,
    serverId: 'fifo-test',
    ownUserId: 1,
    connected: true,
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
const collection = getMessageDeliveryCollection(store);
const tick = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

try {
  assert.equal(
    enqueueMessage({ channelId: 1, message: '<p>A</p>', files: [] }),
    true
  );
  await tick();
  const failedA = Array.from(collection.values()).find(
    (entry) => entry.input.content === '<p>A</p>'
  );
  assert.ok(failedA);
  assert.equal(failedA.status, 'failed');
  assert.equal(
    enqueueMessage({ channelId: 1, message: '<p>B</p>', files: [] }),
    true
  );
  await bStarted.promise;
  const retry = retryMessageDelivery(
    getMessageDatabaseScope(store),
    failedA.id
  );
  assert.ok(retry);
  let retrySettled = false;
  retry.when('settled').then(
    () => {
      retrySettled = true;
    },
    () => {}
  );
  reconcileMessageDelivery(actual(calls[0]!, 1));
  await tick();
  assert.equal(
    retrySettled,
    true,
    'A acknowledgement must settle A immediately while B is still in flight'
  );
  assert.equal(collection.get(failedA.id)?.status, 'confirmed');

  assert.equal(
    enqueueMessage({ channelId: 1, message: '<p>C</p>', files: [] }),
    true
  );
  await tick();
  assert.equal(
    Array.from(collection.values()).find(
      (entry) => entry.input.content === '<p>C</p>'
    )?.status,
    'sending'
  );
  assert.deepEqual(
    calls.map((input) => input.content),
    ['<p>A</p>', '<p>B</p>'],
    'a delayed A acknowledgement cannot let C bypass the earlier in-flight B write'
  );

  bCommit.resolve(2);
  await tick();
  await tick();
  assert.deepEqual(
    calls.map((input) => input.content),
    ['<p>A</p>', '<p>B</p>', '<p>C</p>'],
    'B commit releases C, and the already acknowledged A retry must never send again'
  );
  assert.equal(collection.size, 3);
  assert.ok(
    Array.from(collection.values()).every(
      (entry) => entry.status === 'confirmed'
    )
  );
  assert.equal(sounds.length, 3);
} finally {
  bCommit.resolve(2);
  store.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(store);
  await tick();
}
