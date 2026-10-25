import { SoundType } from '@/features/server/types';
import { ownUserIdSelector } from '@/features/server/users/selectors';
import { store, type IStore } from '@/features/store';
import { playSound } from '@/helpers/sounds';
import { uploadFile, type TUploadedAttachment } from '@/helpers/upload-file';
import { i18n } from '@/i18n';
import { getTRPCClient } from '@/lib/trpc';
import {
  getTrpcError,
  prepareMessageHtml,
  TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE,
  type TJoinedMessage
} from '@dodecagon/shared';
import {
  BasicIndex,
  collectionOptions,
  createOptimisticAction,
  eq,
  liveQueryCollectionOptions,
  localOnlyCollectionOptions,
  type Collection,
  type LocalOnlyCollectionUtils
} from '@tanstack/db';
import { TRPCClientError } from '@trpc/client';
import {
  getMessageCollection,
  getMessageDatabase,
  getMessageDatabaseScope,
  isMessageInWindow,
  reportMessageDatabaseError,
  writeSyncedMessage
} from './database';

export type TOutgoingMessage = {
  clientRequestId: string;
  channelId: number;
  content: string;
  files: string[];
  parentMessageId?: number;
  replyToMessageId?: number;
};

// files and transport signals stay outside DB drafts, which clone row values
class DeliveryResources {
  readonly acknowledgement = Promise.withResolvers<TJoinedMessage>();
  readonly cancellation = Promise.withResolvers<undefined>();
  readonly controller = new AbortController();

  constructor(public attachments: TUploadedAttachment[]) {}

  release() {
    this.attachments.splice(0);
  }

  cancel() {
    this.release();
    this.controller.abort();
    this.cancellation.resolve(undefined);
  }
}

type TDeliveryDraft = {
  id: string;
  sequence: number;
  scope: string;
  conversation: string;
  userId: number;
  input: TOutgoingMessage;
  attachments: Pick<TUploadedAttachment, 'id' | 'originalName'>[];
  message?: TJoinedMessage;
};

type TDeliveryState = {
  id: string;
  status: 'sending' | 'failed' | 'confirmed';
  error?: string;
};

export type TMessageDelivery = TDeliveryDraft & TDeliveryState;

const deliveryDraftOptions = collectionOptions('message-delivery-drafts', () =>
  localOnlyCollectionOptions<TDeliveryDraft, string>({
    id: 'message-delivery-drafts',
    getKey: (entry) => entry.id
  })
);
const deliveryStateOptions = collectionOptions('message-delivery-state', () =>
  localOnlyCollectionOptions<TDeliveryState, string>({
    id: 'message-delivery-state',
    getKey: (entry) => entry.id
  })
);
// optimistic status snapshots must not hide a refreshed receipt's native draft/input
const deliveryViewOptions = collectionOptions(
  'message-deliveries',
  (client) => {
    const drafts = client.collection(deliveryDraftOptions);
    const states = client.collection(deliveryStateOptions);
    drafts.createIndex((row) => row.id, { indexType: BasicIndex });
    states.createIndex((row) => row.id, { indexType: BasicIndex });
    return liveQueryCollectionOptions({
      id: 'message-deliveries',
      startSync: true,
      gcTime: 0,
      getKey: (entry: TMessageDelivery) => entry.id,
      query: (q) =>
        q
          .from({ draft: drafts })
          .innerJoin({ state: states }, ({ draft, state }) =>
            eq(draft.id, state.id)
          )
          .select(({ draft, state }) => ({
            id: draft.id,
            sequence: draft.sequence,
            scope: draft.scope,
            conversation: draft.conversation,
            userId: draft.userId,
            input: draft.input,
            attachments: draft.attachments,
            status: state.status,
            error: state.error,
            message: draft.message
          }))
    });
  }
);

export const getMessageDeliveryCollection = (currentStore: IStore) =>
  getMessageDatabase(currentStore).collection(deliveryViewOptions);

type TDeliveryStateCollection = Collection<
  TDeliveryState,
  string,
  LocalOnlyCollectionUtils
>;
type TDeliveryDraftCollection = Collection<
  TDeliveryDraft,
  string,
  LocalOnlyCollectionUtils
>;

type TDeliverySession = {
  scope: string;
  collection: TDeliveryStateCollection;
  drafts: TDeliveryDraftCollection;
  // only application ordering is retained here; all row state and observers are DB-owned
  conversations: Map<string, Promise<void>>;
  windowSubscriptions: Map<string, { unsubscribe: () => void }>;
  // runtime handles survive native row cleanup and contain no delivery/entity state
  resources: Map<string, DeliveryResources>;
  sequence: number;
  stopped: boolean;
  stopObserving: () => void;
};

const sessions = new WeakMap<IStore, TDeliverySession>();

const releaseSession = (session: TDeliverySession, clearRows = true) => {
  session.stopped = true;
  session.stopObserving();
  for (const resources of session.resources.values()) resources.cancel();
  session.resources.clear();
  if (clearRows) {
    const ids = Array.from(session.collection.keys());
    if (ids.length) {
      session.collection.delete(ids);
      session.drafts.delete(ids);
    }
  }
  for (const subscription of session.windowSubscriptions.values())
    subscription.unsubscribe();
  session.windowSubscriptions.clear();
  session.conversations.clear();
};

export const resetMessageDeliveries = (currentStore: IStore = store) => {
  const session = sessions.get(currentStore);
  if (!session) return;
  releaseSession(
    session,
    getMessageDatabaseScope(currentStore) === session.scope
  );
  sessions.delete(currentStore);
};

const getSession = (currentStore: IStore): TDeliverySession => {
  const scope = getMessageDatabaseScope(currentStore);
  const previous = sessions.get(currentStore);
  if (previous && previous.scope === scope && !previous.stopped)
    return previous;
  if (previous) releaseSession(previous, false);
  const session: TDeliverySession = {
    scope,
    collection:
      getMessageDatabase(currentStore).collection(deliveryStateOptions),
    drafts: getMessageDatabase(currentStore).collection(deliveryDraftOptions),
    conversations: new Map(),
    windowSubscriptions: new Map(),
    resources: new Map(),
    sequence: 0,
    stopped: false,
    stopObserving: () => {}
  };
  sessions.set(currentStore, session);
  getMessageDeliveryCollection(currentStore);
  session.stopObserving = currentStore.subscribe(() => {
    if (getMessageDatabaseScope(currentStore) !== scope)
      resetMessageDeliveries(currentStore);
  });
  return session;
};

const isCurrent = (currentStore: IStore, session: TDeliverySession) =>
  !session.stopped && getMessageDatabaseScope(currentStore) === session.scope;

const releaseUnusedWindows = (session: TDeliverySession) => {
  for (const [key, subscription] of session.windowSubscriptions) {
    let hasEntries = false;
    for (const entry of session.drafts.values()) {
      if (entry.conversation !== key) continue;
      hasEntries = true;
      break;
    }
    if (hasEntries) continue;
    subscription.unsubscribe();
    session.windowSubscriptions.delete(key);
  }
};

const observeWindow = (
  currentStore: IStore,
  session: TDeliverySession,
  input: TOutgoingMessage
) => {
  const key = JSON.stringify([input.channelId, input.parentMessageId ?? null]);
  if (session.windowSubscriptions.has(key)) return;
  const collection = getMessageCollection(
    currentStore,
    input.channelId,
    input.parentMessageId
  );
  session.windowSubscriptions.set(
    key,
    collection.subscribeChanges(() => {
      if (!isCurrent(currentStore, session)) return;
      for (const entry of Array.from(session.drafts.values())) {
        if (
          entry.conversation === key &&
          session.collection.get(entry.id)?.status === 'confirmed' &&
          entry.message &&
          isMessageInWindow(currentStore, entry.message)
        ) {
          session.collection.delete(entry.id);
          session.drafts.delete(entry.id);
        }
      }
      releaseUnusedWindows(session);
    })
  );
};

const confirmDelivery = async (
  currentStore: IStore,
  session: TDeliverySession,
  entry: TDeliveryDraft,
  actual: TJoinedMessage
) => {
  const current = session.drafts.get(entry.id);
  if (
    !isCurrent(currentStore, session) ||
    !current ||
    !session.collection.has(entry.id)
  )
    return false;
  const resources = session.resources.get(entry.id);
  resources?.release();
  const message = current.message ?? actual;
  if (!current.message)
    session.drafts.update(entry.id, (draft) => {
      draft.message = message;
    });
  await writeSyncedMessage(currentStore, message);
  if (
    !isCurrent(currentStore, session) ||
    !session.drafts.has(entry.id) ||
    !session.collection.has(entry.id)
  )
    return false;
  if (isMessageInWindow(currentStore, message)) {
    session.collection.delete(entry.id);
    session.drafts.delete(entry.id);
  } else {
    // an own acknowledgement is not proof that an old/partial window is contiguous
    session.collection.update(entry.id, (draft) => {
      draft.status = 'confirmed';
      draft.error = undefined;
    });
  }
  // authoritative delivery ends all retry-only resources and any redundant read-back
  resources?.controller.abort();
  session.resources.delete(entry.id);
  return true;
};

const refreshExpiredAttachments = async (
  currentStore: IStore,
  session: TDeliverySession,
  entry: TDeliveryDraft,
  error: unknown
) => {
  const resources = session.resources.get(entry.id);
  if (!resources) return undefined;
  const attachments = resources.attachments;
  if (
    !(error instanceof TRPCClientError) ||
    error.data?.code !== 'BAD_REQUEST' ||
    error.message !== TEMPORARY_ATTACHMENT_EXPIRED_MESSAGE ||
    !attachments.length ||
    attachments.length !== entry.input.files.length ||
    !attachments.every((attachment) => attachment.sourceFile)
  )
    return undefined;
  const refreshed: TUploadedAttachment[] = [];
  for (const attachment of attachments) {
    if (
      !isCurrent(currentStore, session) ||
      resources.controller.signal.aborted
    )
      return undefined;
    const sourceFile = attachment.sourceFile!;
    const uploaded = await uploadFile(sourceFile, {
      signal: resources.controller.signal
    });
    if (
      !isCurrent(currentStore, session) ||
      resources.controller.signal.aborted
    )
      return undefined;
    if (!uploaded) throw new Error(i18n.t('common:uploadFailed'));
    refreshed.push({ ...uploaded, sourceFile });
  }
  if (!isCurrent(currentStore, session) || resources.controller.signal.aborted)
    return undefined;
  resources.attachments.splice(0, attachments.length, ...refreshed);
  const input = {
    ...entry.input,
    clientRequestId: crypto.randomUUID(),
    files: refreshed.map((attachment) => attachment.id)
  };
  session.drafts.update(entry.id, (draft) => {
    draft.input = input;
    draft.attachments = refreshed.map(({ id, originalName }) => ({
      id,
      originalName
    }));
  });
  return input;
};

const sendAttempt = (
  currentStore: IStore,
  session: TDeliverySession,
  entry: TDeliveryDraft,
  allowAttachmentRefresh: boolean,
  acknowledged?: TJoinedMessage
) => {
  const resources = session.resources.get(entry.id);
  if (!resources) return undefined;
  const collection = session.collection;
  const action = createOptimisticAction({
    onMutate: () => {
      collection.update(entry.id, (draft) => {
        draft.status = 'sending';
        draft.error = undefined;
      });
    },
    mutationFn: async () => {
      if (acknowledged) {
        if (await confirmDelivery(currentStore, session, entry, acknowledged))
          playSound(SoundType.MESSAGE_SENT);
        return;
      }
      const trpc = getTRPCClient();
      const key = JSON.stringify([
        entry.input.channelId,
        entry.input.parentMessageId ?? null
      ]);
      const previous = session.conversations.get(key) ?? Promise.resolve();
      const operation = previous.then(async () => {
        if (
          !isCurrent(currentStore, session) ||
          resources.controller.signal.aborted ||
          collection.get(entry.id)?.status !== 'sending'
        )
          return undefined;
        let input = entry.input;
        let messageId: number;
        try {
          messageId = await trpc.messages.send.mutate(input, {
            signal: resources.controller.signal
          });
        } catch (error) {
          if (!allowAttachmentRefresh) throw error;
          const refreshed = await refreshExpiredAttachments(
            currentStore,
            session,
            entry,
            error
          );
          if (
            !isCurrent(currentStore, session) ||
            resources.controller.signal.aborted
          )
            return undefined;
          if (!refreshed) throw error;
          input = refreshed;
          messageId = await trpc.messages.send.mutate(input, {
            signal: resources.controller.signal
          });
        }
        if (
          !isCurrent(currentStore, session) ||
          resources.controller.signal.aborted
        )
          return undefined;
        return trpc.messages.getOne.query(
          { messageId },
          {
            signal: resources.controller.signal
          }
        );
      });
      const outcome = Promise.race([
        operation,
        resources.acknowledgement.promise,
        resources.cancellation.promise
      ]);
      const completedOutcome = outcome.then(
        () => {},
        () => {}
      );
      // an acknowledgement settles this action, not an earlier admitted write
      const completion = previous
        .then(() => completedOutcome)
        .finally(() => {
          if (session.conversations.get(key) === completion)
            session.conversations.delete(key);
        });
      session.conversations.set(key, completion);
      const actual = await outcome;
      if (!actual || !isCurrent(currentStore, session)) return;
      if (await confirmDelivery(currentStore, session, entry, actual))
        playSound(SoundType.MESSAGE_SENT);
      // do not accept the transient `sending` mutation: settlement removes its
      // optimistic layer and reveals the confirmed/deleted local job above
    }
  });
  const transaction = action(undefined);
  transaction
    .when('settled')
    .catch((error: unknown) => {
      if (!isCurrent(currentStore, session) || !collection.has(entry.id))
        return;
      collection.update(entry.id, (draft) => {
        draft.status = 'failed';
        draft.error = getTrpcError(error, i18n.t('common:failedSendMessage'));
      });
    })
    .finally(() => {
      if (!session.stopped) releaseUnusedWindows(session);
    });
  return transaction;
};

export const enqueueMessage = (
  {
    channelId,
    message,
    files,
    parentMessageId,
    replyToMessageId
  }: {
    channelId: number;
    message: string;
    files: TUploadedAttachment[];
    parentMessageId?: number;
    replyToMessageId?: number;
  },
  currentStore: IStore = store
) => {
  const userId = ownUserIdSelector(currentStore.getState());
  if (userId === undefined) return false;
  const session = getSession(currentStore);
  const clientRequestId = crypto.randomUUID();
  const entry: TDeliveryDraft = {
    id: `request:${userId}:${clientRequestId}`,
    sequence: session.sequence++,
    scope: session.scope,
    userId,
    conversation: JSON.stringify([channelId, parentMessageId ?? null]),
    input: {
      clientRequestId,
      channelId,
      content: prepareMessageHtml(message),
      files: files.map((file) => file.id),
      parentMessageId,
      replyToMessageId
    },
    attachments: files.map(({ id, originalName }) => ({ id, originalName }))
  };
  session.resources.set(entry.id, new DeliveryResources([...files]));
  // this local draft survives a failed optimistic send; no network runs until
  // the action below, so accepted enqueue frees the editor immediately
  session.drafts.insert(entry);
  session.collection.insert({ id: entry.id, status: 'failed' });
  observeWindow(currentStore, session, entry.input);
  sendAttempt(currentStore, session, entry, false);
  return true;
};

export const retryMessageDelivery = (
  scope: string,
  id: string,
  currentStore: IStore = store
) => {
  const session = sessions.get(currentStore);
  if (!session || session.scope !== scope || !isCurrent(currentStore, session))
    return;
  const state = session.collection.get(id);
  const entry = session.drafts.get(id);
  if (!entry || state?.status !== 'failed') return;
  return sendAttempt(currentStore, session, entry, true);
};

export const discardMessageDelivery = (
  scope: string,
  id: string,
  currentStore: IStore = store
) => {
  const session = sessions.get(currentStore);
  if (!session || session.scope !== scope || !isCurrent(currentStore, session))
    return;
  const entry = session.collection.get(id);
  if (!entry || entry.status !== 'failed') return;
  session.resources.get(id)?.cancel();
  session.resources.delete(id);
  session.collection.delete(id);
  session.drafts.delete(id);
  releaseUnusedWindows(session);
};

export const reconcileMessageDeliveryDeletion = (
  channelId: number,
  messageId: number,
  currentStore: IStore = store
) => {
  const session = sessions.get(currentStore);
  if (!session || !isCurrent(currentStore, session)) return;
  for (const entry of Array.from(session.drafts.values())) {
    if (entry.message?.channelId !== channelId) continue;
    if (entry.message.id === messageId) {
      session.resources.get(entry.id)?.cancel();
      session.resources.delete(entry.id);
      session.collection.delete(entry.id);
      session.drafts.delete(entry.id);
    } else if (
      entry.message.replyToMessageId === messageId ||
      entry.message.replyTo?.id === messageId
    ) {
      session.drafts.update(entry.id, (draft) => {
        if (!draft.message) return;
        draft.message = {
          ...draft.message,
          replyToMessageId: null,
          replyTo: null
        };
      });
    }
  }
  releaseUnusedWindows(session);
};

export const reconcileMessageDelivery = (
  actual: TJoinedMessage,
  currentStore: IStore = store
) => {
  const session = sessions.get(currentStore);
  if (!session || !isCurrent(currentStore, session) || !actual.clientRequestId)
    return;
  for (const entry of Array.from(session.drafts.values())) {
    if (
      entry.userId !== actual.userId ||
      entry.input.clientRequestId !== actual.clientRequestId ||
      entry.input.channelId !== actual.channelId ||
      (entry.input.parentMessageId ?? null) !== actual.parentMessageId
    )
      continue;
    const state = session.collection.get(entry.id);
    if (!state) continue;
    // record the authoritative payload before async settlement so deletion can observe it
    session.drafts.update(entry.id, (draft) => {
      draft.message = actual;
    });
    const resources = session.resources.get(entry.id);
    resources?.release();
    if (state.status === 'sending') {
      // an event wins even if send/getOne later rejects; the action itself owns
      // the one delivery callback/sound and its native transaction settlement
      resources?.acknowledgement.resolve(actual);
    } else if (state.status === 'failed') {
      sendAttempt(currentStore, session, entry, false, actual);
    } else {
      confirmDelivery(currentStore, session, entry, actual).catch(
        reportMessageDatabaseError
      );
    }
  }
};
