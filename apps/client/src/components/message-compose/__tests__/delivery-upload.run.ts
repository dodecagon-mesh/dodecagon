import type { TOutgoingMessage } from '@/features/server/messages/delivery';
import {
  ChannelType,
  TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE,
  type TChannel
} from '@dodecagon/shared';
import { TRPCClientError } from '@trpc/client';
import { mock } from 'bun:test';
import assert from 'node:assert/strict';

const uploadsStarted = Promise.withResolvers<void>();
class RecordingXHR extends EventTarget {
  static requests: RecordingXHR[] = [];
  upload = new EventTarget();
  status = 0;
  statusText = '';
  responseText = '';
  aborted = false;
  body: unknown;
  headers = new Map<string, string>();
  open() {
    RecordingXHR.requests.push(this);
  }
  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  send(body: unknown) {
    this.body = body;
    uploadsStarted.resolve();
  }
  abort() {
    this.aborted = true;
    this.dispatchEvent(new Event('abort'));
  }
}
Object.defineProperty(globalThis, 'XMLHttpRequest', {
  value: RecordingXHR,
  configurable: true
});
const requests: TOutgoingMessage[] = [];
const toasts: string[] = [];
const expired = TRPCClientError.from({
  error: {
    message: TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE,
    code: -32600,
    data: { code: 'BAD_REQUEST', httpStatus: 400 }
  }
});
mock.module('@/lib/trpc', () => ({
  getTRPCClient: () => ({
    messages: {
      send: {
        mutate: async (input: TOutgoingMessage) => {
          requests.push(input);
          throw expired;
        }
      },
      getOne: {
        query: () => {
          throw new Error('an expired receipt has no confirmed message');
        }
      },
      get: {
        query: async () => ({ messages: [], nextCursor: null, hasNewer: false })
      },
      getThread: { query: async () => ({ messages: [], nextCursor: null }) }
    }
  })
}));
mock.module('@/helpers/get-file-url', () => ({
  getUrlFromServer: () => 'https://original-server.test',
  getHostFromServer: () => 'original-server.test',
  getFileUrl: () => ''
}));
mock.module('sonner', () => ({
  toast: { error: (message: string) => toasts.push(message) }
}));
mock.module('@/helpers/sounds', () => ({
  playSound: () => {
    throw new Error('an expired send must not play a success sound');
  }
}));
mock.module('@/helpers/browser-logger', () => ({ logDebug: () => {} }));
mock.module('@/helpers/voice-debug', () => ({ pushVoiceDebugEvent: () => {} }));
mock.module('@/features/server/actions', () => ({
  markChannelAsRead: () => {}
}));
mock.module('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
// production modules load after transport/platform mocks; native DB and the upload helper remain real
const { store } = await import('@/features/store');
const { serverInitialState, serverSliceActions } =
  await import('@/features/server/slice');
const { getMessageDatabaseScope, disposeMessageDatabase } =
  await import('@/features/server/messages/database');
const { enqueueMessage, getMessageDeliveryCollection, retryMessageDelivery } =
  await import('@/features/server/messages/delivery');
const { uploadFile } = await import('@/helpers/upload-file');
store.setState({
  server: {
    ...serverInitialState,
    serverId: 'original-server',
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
const sourceFile = new File(['retained payload'], 'attachment.txt', {
  type: 'text/plain'
});
const attachment = {
  id: 'expired-upload',
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
    message: '<p>original draft</p>',
    files: [attachment]
  }),
  true
);
const tick = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};
await tick();
const failed = Array.from(getMessageDeliveryCollection(store).values())[0]!;
assert.equal(failed.status, 'failed');
const retry = retryMessageDelivery(getMessageDatabaseScope(store), failed.id)!;
await uploadsStarted.promise;
assert.deepEqual(
  requests[1],
  requests[0],
  'explicit retry replays the original receipt before uploading'
);
assert.equal(RecordingXHR.requests.length, 1);
const xhr = RecordingXHR.requests[0]!;
assert.equal(
  xhr.body,
  sourceFile,
  'expiry recovery uploads the original File object'
);
store.dispatch(serverSliceActions.resetState());
await disposeMessageDatabase(store);
assert.equal(
  xhr.aborted,
  true,
  'scope reset must abort the actual expiry-recovery XHR'
);
await retry.when('settled').catch(() => {});
await tick();
assert.equal(
  requests.length,
  2,
  'an aborted old-scope upload cannot send a new receipt'
);
assert.equal(getMessageDeliveryCollection(store).size, 0);
assert.deepEqual(
  toasts,
  [],
  'intentional cancellation must not report an upload failure'
);

// the actual helper must settle on cancellation, independently of the delivery action's cancellation race
const controller = new AbortController();
const upload = uploadFile(sourceFile, { signal: controller.signal });
let settled = false;
upload.then((result) => {
  assert.equal(result, undefined);
  settled = true;
});
controller.abort();
await tick();
assert.equal(
  settled,
  true,
  'aborting an XHR must settle uploadFile, not leave an orphaned promise'
);
assert.equal(RecordingXHR.requests[1]?.aborted, true);
const before = RecordingXHR.requests.length;
assert.equal(
  await uploadFile(sourceFile, { signal: controller.signal }),
  undefined
);
assert.equal(
  RecordingXHR.requests.length,
  before,
  'a pre-aborted upload must not start network IO'
);
assert.deepEqual(toasts, []);
store.dispatch(serverSliceActions.resetState());
await disposeMessageDatabase(store);
