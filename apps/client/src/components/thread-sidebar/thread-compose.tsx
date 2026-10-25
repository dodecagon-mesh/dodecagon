import { getChannelDraftKey } from '@/components/channel-view/text/use-draft-messages';
import {
  MessageCompose,
  type TMessageComposeHandle
} from '@/components/message-compose';
import { enqueueMessage } from '@/features/server/messages/delivery';
import { useTypingSignal } from '@/hooks/use-typing-signal';
import type { TReplyTarget } from '@/types';
import type {
  TJoinedMessage,
  TJoinedPublicUser,
  TTempFile
} from '@dodecagon/shared';
import { memo, useCallback, useMemo, type Ref } from 'react';

type TThreadComposeProps = {
  parentMessageId: number;
  channelId: number;
  typingUsers: TJoinedPublicUser[];
  replyingToMessage?: TJoinedMessage;
  onCancelReply?: () => void;
  onArrowUp?: () => void;
  ref?: Ref<TMessageComposeHandle>;
  onResize?: () => void;
};

const ThreadCompose = memo(
  ({
    parentMessageId,
    channelId,
    typingUsers,
    replyingToMessage,
    onCancelReply,
    onArrowUp,
    ref,
    onResize
  }: TThreadComposeProps) => {
    const replyTarget = useMemo<TReplyTarget | undefined>(() => {
      if (!replyingToMessage) return undefined;
      if (replyingToMessage.pluginId)
        return { userId: null, pluginId: replyingToMessage.pluginId };
      return { userId: replyingToMessage.userId, pluginId: null };
    }, [replyingToMessage]);
    const sendTypingSignal = useTypingSignal(channelId, parentMessageId);
    const draftKey = getChannelDraftKey(channelId, parentMessageId);
    const onSend = useCallback(
      (message: string, files: TTempFile[]) => {
        const accepted = enqueueMessage({
          channelId,
          message,
          files,
          parentMessageId,
          replyToMessageId: replyingToMessage?.id
        });
        if (accepted) {
          sendTypingSignal.cancel();
          onCancelReply?.();
        }
        return accepted;
      },
      [
        channelId,
        parentMessageId,
        replyingToMessage?.id,
        sendTypingSignal,
        onCancelReply
      ]
    );

    return (
      <MessageCompose
        key={draftKey}
        ref={ref}
        channelId={channelId}
        draftKey={draftKey}
        onSend={onSend}
        onTyping={sendTypingSignal}
        typingUsers={typingUsers}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
        onArrowUp={onArrowUp}
        onResize={onResize}
        isThread
      />
    );
  }
);

export { ThreadCompose };
