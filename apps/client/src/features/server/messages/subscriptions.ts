import { store } from '@/features/store';
import { logDebug } from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import type { TJoinedMessage } from '@dodecagon/shared';
import { handleSubscriptionError } from '../subscription-error';
import {
  addMessages,
  addTypingUser,
  deleteMessage,
  updateMessage,
  updateReplyCount
} from './actions';
import { getMessageDatabaseScope } from './database';
import {
  reconcileMessageDelivery,
  reconcileMessageDeliveryDeletion
} from './delivery';

const subscribeToMessages = () => {
  const trpc = getTRPCClient();
  const scope = getMessageDatabaseScope(store);

  const onMessageSub = trpc.messages.onNew.subscribe(undefined, {
    onData: (message: TJoinedMessage) => {
      if (getMessageDatabaseScope(store) !== scope) return;
      logDebug('[EVENTS] messages.onNew', { message });
      addMessages(message.channelId, [message], true);
      reconcileMessageDelivery(message);
    },
    onError: handleSubscriptionError('onMessage')
  });

  const onMessageUpdateSub = trpc.messages.onUpdate.subscribe(undefined, {
    onData: (message: TJoinedMessage) => {
      if (getMessageDatabaseScope(store) !== scope) return;
      logDebug('[EVENTS] messages.onUpdate', { message });
      updateMessage(message);
      reconcileMessageDelivery(message);
    },
    onError: handleSubscriptionError('onMessageUpdate')
  });

  const onMessageDeleteSub = trpc.messages.onDelete.subscribe(undefined, {
    onData: ({ messageId, channelId }) => {
      if (getMessageDatabaseScope(store) !== scope) return;
      logDebug('[EVENTS] messages.onDelete', { messageId, channelId });
      deleteMessage(channelId, messageId);
      reconcileMessageDeliveryDeletion(channelId, messageId);
    },
    onError: handleSubscriptionError('onMessageDelete')
  });

  const onMessageTypingSub = trpc.messages.onTyping.subscribe(undefined, {
    onData: ({
      userId,
      channelId,
      parentMessageId
    }: {
      userId: number;
      channelId: number;
      parentMessageId?: number;
    }) => {
      if (getMessageDatabaseScope(store) !== scope) return;
      logDebug('[EVENTS] messages.onTyping', {
        userId,
        channelId,
        parentMessageId
      });
      addTypingUser(channelId, userId, parentMessageId);
    },
    onError: handleSubscriptionError('onMessageTyping')
  });

  const onThreadReplyCountUpdateSub =
    trpc.messages.onThreadReplyCountUpdate.subscribe(undefined, {
      onData: ({
        messageId,
        channelId,
        replyCount
      }: {
        messageId: number;
        channelId: number;
        replyCount: number;
      }) => {
        if (getMessageDatabaseScope(store) !== scope) return;
        logDebug('[EVENTS] messages.onThreadReplyCountUpdate', {
          messageId,
          channelId,
          replyCount
        });
        updateReplyCount(channelId, messageId, replyCount);
      },
      onError: handleSubscriptionError('onThreadReplyCountUpdate')
    });

  return () => {
    onMessageSub.unsubscribe();
    onMessageUpdateSub.unsubscribe();
    onMessageDeleteSub.unsubscribe();
    onMessageTypingSub.unsubscribe();
    onThreadReplyCountUpdateSub.unsubscribe();
  };
};

export { subscribeToMessages };
