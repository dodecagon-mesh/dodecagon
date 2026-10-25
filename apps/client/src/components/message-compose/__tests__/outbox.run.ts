import type { TOutgoingMessage } from '@/features/server/messages/delivery';
import {
  ChannelType,
  TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE,
  type TChannel,
  type TJoinedMessage
} from '@dodecagon/shared';
import { TRPCClientError } from '@trpc/client';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

const scenario = process.argv[2];
const pending = Promise.withResolvers<number>();
const readback = Promise.withResolvers<TJoinedMessage>();
let holdReadback = false;
const uploadBarrier = Promise.withResolvers<void>();
let holdUpload = false;
const readbacks: number[] = [];
const requestSignals: AbortSignal[] = [];
const readbackSignals: AbortSignal[] = [];
const uploadSignals: AbortSignal[] = [];
let onDelete:
  ((event: { messageId: number; channelId: number }) => void) | undefined;
const ignoredSubscription = { subscribe: () => ({ unsubscribe: () => {} }) };
const requests: TOutgoingMessage[] = [];
const sounds: unknown[] = [];
const uploads: File[] = [];
let mode: 'pending' | 'offline' | 'success' | 'expired' | 'ambiguous' =
  'pending';
const actual = (input: TOutgoingMessage, userId = 1): TJoinedMessage => ({
  id: 20 + requests.indexOf(input),
  createdAt: 20,
  updatedAt: null,
  channelId: input.channelId,
  userId,
  pluginId: null,
  parentMessageId: input.parentMessageId ?? null,
  replyToMessageId: input.replyToMessageId ?? null,
  clientRequestId: input.clientRequestId,
  content: '<p>sanitized server content</p>',
  files: [],
  reactions: [],
  metadata: null,
  editable: true,
  pinned: false,
  pinnedAt: null,
  pinnedBy: null,
  editedAt: null,
  editedBy: null,
  replyTo: input.replyToMessageId
    ? {
        id: input.replyToMessageId,
        content: '<p>quoted content</p>',
        userId: 1,
        pluginId: null
      }
    : null,
  replyCount: 0
});
const expired = TRPCClientError.from({
  error: {
    message: TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE,
    code: -32600,
    data: { code: 'BAD_REQUEST', httpStatus: 400 }
  }
});
const trpc = {
  messages: {
    send: {
      mutate: async (
        input: TOutgoingMessage,
        options?: { signal?: AbortSignal }
      ) => {
        if (options?.signal) requestSignals.push(options.signal);
        requests.push(input);
        if (mode === 'pending') return pending.promise;
        if (mode === 'offline') throw new Error('offline');
        if (mode === 'ambiguous')
          throw new Error(TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE);
        if (mode === 'expired' && input.files[0] === 'old-upload')
          throw expired;
        return 20 + requests.length - 1;
      }
    },
    getOne: {
      query: async (
        { messageId }: { messageId: number },
        options?: { signal?: AbortSignal }
      ) => {
        if (options?.signal) readbackSignals.push(options.signal);
        readbacks.push(messageId);
        if (holdReadback) return readback.promise;
        const input = requests[messageId - 20]!;
        return actual(input);
      }
    },
    get: {
      query: async () => ({ messages: [], nextCursor: null, hasNewer: false })
    },
    getThread: { query: async () => ({ messages: [], nextCursor: null }) },
    onNew: ignoredSubscription,
    onUpdate: ignoredSubscription,
    onTyping: ignoredSubscription,
    onThreadReplyCountUpdate: ignoredSubscription,
    onDelete: {
      subscribe: (
        _input: unknown,
        handlers: {
          onData: (event: { messageId: number; channelId: number }) => void;
        }
      ) => {
        onDelete = handlers.onData;
        return { unsubscribe: () => {} };
      }
    }
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
  uploadFile: async (file: File, options?: { signal?: AbortSignal }) => {
    if (options?.signal) uploadSignals.push(options.signal);
    uploads.push(file);
    if (holdUpload) await uploadBarrier.promise;
    return {
      id: 'new-upload',
      originalName: file.name,
      md5: 'new-hash',
      size: file.size,
      path: '/temporary',
      extension: '.txt',
      userId: 1
    };
  }
}));
globalThis.document = { hidden: false } as Document;
// imports follow transport mocks because this fixture exercises module-loading/session boundaries
const { store, createStore } = await import('@/features/store');
const { serverInitialState } = await import('@/features/server/slice');
const {
  getMessageDatabaseScope,
  getMessageCollection,
  disposeMessageDatabase
} = await import('@/features/server/messages/database');
const {
  enqueueMessage,
  getMessageDeliveryCollection,
  retryMessageDelivery,
  discardMessageDelivery,
  reconcileMessageDelivery
} = await import('@/features/server/messages/delivery');
const { serverSliceActions } = await import('@/features/server/slice');
store.setState({
  server: {
    ...serverInitialState,
    serverId: 'server-one',
    connected: true,
    ownUserId: 1,
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
const entries = () => Array.from(collection.values());
const tick = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};
const sourceFile = new File(['payload'], 'attachment.txt', {
  type: 'text/plain'
});
const attachment = {
  id: 'old-upload',
  originalName: sourceFile.name,
  md5: 'hash',
  size: sourceFile.size,
  path: '/temporary',
  extension: '.txt',
  userId: 1,
  sourceFile
};
const send = (
  content = '<p>original text</p>',
  files = [attachment],
  parentMessageId?: number
) => enqueueMessage({ channelId: 1, message: content, files, parentMessageId });
const scope = getMessageDatabaseScope(store);

if (scenario === 'ordered-immediate') {
  assert.equal(send(), true);
  assert.equal(send('<p>second text</p>', []), true);
  assert.deepEqual(
    entries().map((entry) => entry.status),
    ['sending', 'sending']
  );
  assert.equal(
    entries().find((entry) => entry.input.content === '<p>original text</p>')
      ?.attachments[0]?.originalName,
    'attachment.txt'
  );
  await tick();
  assert.equal(
    requests.length,
    1,
    'a second request must wait for its conversation predecessor'
  );
  mode = 'success';
  pending.resolve(20);
  await tick();
  await tick();
  assert.deepEqual(
    requests.map((input) => input.content),
    ['<p>original text</p>', '<p>second text</p>']
  );
  assert.ok(entries().every((entry) => entry.status === 'confirmed'));
  assert.equal(sounds.length, 2);
} else if (scenario === 'event-before-error') {
  send();
  await tick();
  const original = entries()[0]!;
  const acknowledged = actual(requests[0]!);
  reconcileMessageDelivery(acknowledged);
  await tick();
  assert.equal(
    requestSignals[0]?.aborted,
    true,
    'an authoritative event ends redundant transport IO'
  );
  pending.reject(new Error('response lost'));
  await tick();
  assert.equal(entries()[0]?.status, 'confirmed');
  assert.equal(
    entries()[0]?.message?.content,
    '<p>sanitized server content</p>'
  );
  assert.equal(retryMessageDelivery(scope, original.id), undefined);
  reconcileMessageDelivery(acknowledged);
  assert.equal(sounds.length, 1);
} else if (scenario === 'event-unblocks-next-send') {
  send();
  await tick();
  reconcileMessageDelivery(actual(requests[0]!));
  mode = 'success';
  send('<p>next draft</p>', []);
  await tick();
  await tick();
  assert.equal(
    requests.length,
    2,
    'an authoritative event must release conversation order even when the old response never returns'
  );
  assert.deepEqual(
    entries().map((entry) => entry.status),
    ['confirmed', 'confirmed']
  );
  assert.equal(sounds.length, 2);
} else if (scenario === 'explicit-retry') {
  mode = 'offline';
  send();
  await tick();
  const failed = entries()[0]!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'offline');
  assert.equal(requests.length, 1, 'failure must not auto-retry');
  mode = 'success';
  await retryMessageDelivery(scope, failed.id)?.when('settled');
  await tick();
  assert.deepEqual(
    requests[1],
    requests[0],
    'retry uses the captured request, not a newer editor draft'
  );
  assert.equal(entries()[0]?.status, 'confirmed');
  assert.equal(
    entries()[0]?.message?.content,
    '<p>sanitized server content</p>'
  );
} else if (
  scenario === 'attachment-expiry' ||
  scenario === 'ambiguous-attachment-error'
) {
  mode = scenario === 'attachment-expiry' ? 'expired' : 'ambiguous';
  send();
  await tick();
  const failed = entries()[0]!;
  assert.equal(failed.status, 'failed');
  assert.equal(uploads.length, 0, 'initial failure cannot refresh attachments');
  await retryMessageDelivery(scope, failed.id)
    ?.when('settled')
    .catch(() => {});
  await tick();
  assert.deepEqual(
    requests[1],
    requests[0],
    'explicit retry must replay the original receipt first'
  );
  if (scenario === 'attachment-expiry') {
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0], sourceFile);
    assert.equal(requests.length, 3);
    assert.notEqual(requests[2]?.clientRequestId, requests[0]?.clientRequestId);
    assert.deepEqual(requests[2]?.files, ['new-upload']);
    assert.equal(entries()[0]?.status, 'confirmed');
    assert.equal(
      entries()[0]?.id,
      failed.id,
      'expiry recovery must preserve the consumer row identity'
    );
  } else {
    assert.equal(
      uploads.length,
      0,
      'ambiguous transport errors cannot mint a new receipt'
    );
    assert.equal(entries()[0]?.status, 'failed');
    assert.equal(requests.length, 2);
  }
} else if (scenario === 'expiry-event-before-error') {
  mode = 'expired';
  send();
  await tick();
  const failed = entries()[0]!;
  holdReadback = true;
  const retry = retryMessageDelivery(scope, failed.id)!;
  await tick();
  assert.equal(requests.length, 3);
  assert.notEqual(requests[2]!.clientRequestId, requests[0]!.clientRequestId);
  assert.equal(entries()[0]?.status, 'sending');
  assert.equal(
    entries()[0]?.input.clientRequestId,
    requests[2]!.clientRequestId,
    'native optimistic status must not hide a renewed authoritative receipt from consumers'
  );
  reconcileMessageDelivery(actual(requests[2]!));
  readback.reject(new Error('renewed receipt readback lost'));
  await retry.when('settled');
  assert.equal(entries()[0]?.status, 'confirmed');
  assert.equal(
    entries()[0]?.message?.clientRequestId,
    requests[2]!.clientRequestId
  );
  assert.equal(sounds.length, 1);
} else if (scenario === 'cancel-releases-files') {
  mode = 'offline';
  send();
  await tick();
  const failed = entries()[0]!;
  discardMessageDelivery(scope, failed.id);
  assert.equal(entries().length, 0);
  assert.equal(requestSignals[0]?.aborted, true);
  assert.equal(retryMessageDelivery(scope, failed.id), undefined);
} else if (scenario === 'session-reset') {
  send();
  await tick();
  // production session actions notify lifecycle observers; setState deliberately does not
  store.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(store);
  assert.equal(
    requestSignals[0]?.aborted,
    true,
    'the original RPC is cancelled before its response resolves'
  );
  pending.resolve(20);
  await tick();
  assert.equal(getMessageDeliveryCollection(store).size, 0);
  assert.equal(
    sounds.length,
    0,
    'old completion cannot write into the new user database'
  );
  assert.deepEqual(
    readbacks,
    [],
    'an obsolete send response cannot query the new session'
  );
} else if (scenario === 'cleanup-before-scope-observer') {
  send();
  await tick();
  // the production scope observer begins native DB retirement before delivery cancels its IO
  store.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(store);
  await tick();
  assert.equal(collection.size, 0);
  assert.equal(requestSignals[0]?.aborted, true);
  pending.resolve(20);
  await tick();
  assert.deepEqual(readbacks, []);
  assert.equal(getMessageDeliveryCollection(store).size, 0);
  assert.equal(sounds.length, 0);
} else if (scenario === 'scope-during-readback') {
  mode = 'success';
  holdReadback = true;
  send();
  await tick();
  assert.deepEqual(readbacks, [20]);
  store.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(store);
  assert.equal(readbackSignals[0]?.aborted, true);
  readback.resolve(actual(requests[0]!));
  await tick();
  assert.equal(getMessageDeliveryCollection(store).size, 0);
  assert.equal(sounds.length, 0);
} else if (scenario === 'scope-during-reupload') {
  mode = 'expired';
  send();
  await tick();
  const failed = entries()[0]!;
  holdUpload = true;
  const retry = retryMessageDelivery(scope, failed.id)!;
  await tick();
  assert.equal(uploads.length, 1);
  store.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(store);
  assert.equal(
    uploadSignals[0]?.aborted,
    true,
    'old-scope expiry recovery passes cancellation into uploadFile'
  );
  uploadBarrier.resolve();
  await retry.when('settled').catch(() => {});
  await tick();
  assert.equal(
    requests.length,
    2,
    'old receipt replay is the final request before scope reset; no new UUID send is allowed'
  );
  assert.equal(getMessageDeliveryCollection(store).size, 0);
  assert.equal(sounds.length, 0);
} else if (scenario === 'scope-security') {
  send('<p>thread draft</p>', [attachment], 4);
  await tick();
  reconcileMessageDelivery({ ...actual(requests[0]!), userId: 2 });
  reconcileMessageDelivery({ ...actual(requests[0]!), channelId: 2 });
  reconcileMessageDelivery({ ...actual(requests[0]!), parentMessageId: null });
  await tick();
  assert.equal(entries()[0]?.status, 'sending');
  assert.equal(
    requestSignals[0]?.aborted,
    false,
    'a forged acknowledgement cannot cancel a different user/channel/thread send'
  );
  const otherStore = createStore();
  otherStore.setState({
    server: { ...serverInitialState, serverId: 'server-one', ownUserId: 1 }
  });
  assert.equal(
    getMessageDeliveryCollection(otherStore).size,
    0,
    'SSR/request databases cannot share outgoing jobs'
  );
  assert.equal(sounds.length, 0);
  otherStore.dispatch(serverSliceActions.resetState());
  await disposeMessageDatabase(otherStore);
} else if (scenario === 'temporary-reconnect') {
  send();
  await tick();
  store.dispatch(serverSliceActions.setConnected(false));
  store.dispatch(serverSliceActions.setConnected(true));
  assert.equal(entries()[0]?.status, 'sending');
  assert.equal(
    requestSignals[0]?.aborted,
    false,
    'same-identity reconnect preserves admitted transport work'
  );
  mode = 'success';
  pending.resolve(20);
  await tick();
  assert.equal(entries()[0]?.status, 'confirmed');
  assert.equal(sounds.length, 1);
} else if (scenario === 'confirmed-deletion-and-quote') {
  mode = 'success';
  const { subscribeToMessages } =
    await import('@/features/server/messages/subscriptions');
  const stop = subscribeToMessages();
  send('<p>first confirmed outside window</p>', []);
  await tick();
  assert.equal(
    enqueueMessage({
      channelId: 1,
      message: '<p>quoted reply</p>',
      files: [],
      replyToMessageId: 20
    }),
    true
  );
  await tick();
  assert.deepEqual(
    entries().map((entry) => entry.status),
    ['confirmed', 'confirmed']
  );
  assert.equal(
    entries().find((entry) => entry.message?.id === 21)?.message?.replyTo
      ?.content,
    '<p>quoted content</p>'
  );
  assert.ok(onDelete);
  onDelete({ channelId: 2, messageId: 20 });
  await tick();
  assert.equal(
    entries().length,
    2,
    'numeric message IDs cannot delete another channel overlay'
  );
  onDelete({ channelId: 1, messageId: 20 });
  await tick();
  assert.deepEqual(
    entries().map((entry) => entry.message?.id),
    [21]
  );
  assert.equal(
    entries()[0]?.message?.replyTo,
    null,
    'deletion removes the confirmed quote snapshot too'
  );
  assert.equal(entries()[0]?.message?.replyToMessageId, null);
  onDelete({ channelId: 1, messageId: 21 });
  await tick();
  assert.equal(entries().length, 0);
  assert.equal(requests.length, 2);
  assert.equal(
    sounds.length,
    2,
    'deletion does not replay delivery side effects'
  );
  stop();
} else if (scenario === 'ack-deletion-before-settlement') {
  const { subscribeToMessages } =
    await import('@/features/server/messages/subscriptions');
  const stop = subscribeToMessages();
  send();
  await tick();
  const acknowledged = actual(requests[0]!);
  reconcileMessageDelivery(acknowledged);
  assert.ok(onDelete);
  onDelete({ channelId: 1, messageId: acknowledged.id });
  await tick();
  assert.equal(
    entries().length,
    0,
    'a deletion between acknowledgement and native settlement must not resurrect the overlay'
  );
  assert.equal(requestSignals[0]?.aborted, true);
  pending.resolve(20);
  await tick();
  assert.equal(entries().length, 0);
  assert.equal(
    getMessageCollection(store, 1).size,
    0,
    'late read-back cannot reinsert the deleted acknowledged message'
  );
  assert.equal(requests.length, 1);
  stop();
} else throw new Error(`Unknown scenario: ${scenario}`);
store.dispatch(serverSliceActions.resetState());
await disposeMessageDatabase(store);
pending.resolve(20);
await tick();
