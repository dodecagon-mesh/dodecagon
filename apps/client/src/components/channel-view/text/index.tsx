import { MessageCompose } from '@/components/message-compose';
import { PendingMessages } from '@/components/message-compose/pending-messages';
import { useThreadSidebar } from '@/features/app/hooks';
import { useChannelById } from '@/features/server/channels/hooks';
import {
  useChannelCan,
  useTypingUsersByChannelId
} from '@/features/server/hooks';
import { enqueueMessage } from '@/features/server/messages/delivery';
import { nextFrame } from '@/features/server/messages/helpers';
import { useMessages } from '@/features/server/messages/hooks';
import { useUserById } from '@/features/server/users/hooks';
import { useTypingSignal } from '@/hooks/use-typing-signal';
import type { TReplyTarget } from '@/types';
import {
  ChannelPermission,
  TestId,
  type TJoinedMessage,
  type TTempFile
} from '@dodecagon/shared';
import { ArrowDownIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useArrowUpEdit } from './hooks/use-arrow-up-edit';
import { useDmPartner } from './hooks/use-dm-partner';
import { useScrollToJumpTarget } from './hooks/use-scroll-to-jump-target';
import { MessageHistory, type TMessageHistoryHandle } from './message-history';
import { TextNoAccess } from './text-no-access';
import { TextTopbar } from './text-top-bar';
import { getChannelDraftKey } from './use-draft-messages';

type TChannelProps = {
  channelId: number;
  onClose?: () => void;
  onToggleRightSidebar?: () => void;
  isRightSidebarOpen?: boolean;
};

const historyComponents = { Footer: PendingMessages };

const TextChannel = memo(
  ({
    channelId,
    onClose,
    onToggleRightSidebar,
    isRightSidebarOpen
  }: TChannelProps) => {
    const { t } = useTranslation();
    const channel = useChannelById(channelId);
    const dmPartnerId = useDmPartner(channelId, !!channel?.isDm);
    const dmPartner = useUserById(dmPartnerId ?? null);
    const {
      messages,
      hasMore,
      loadMore,
      loading,
      fetching,
      scrollToMessage,
      detachedFromPresent,
      returnToPresent
    } = useMessages(channelId);
    useScrollToJumpTarget(channelId, scrollToMessage);
    const draftKey = getChannelDraftKey(channelId);
    const [replyingToMessage, setReplyingToMessage] = useState<
      TJoinedMessage | undefined
    >();
    const typingUsers = useTypingUsersByChannelId(channelId);
    const { activeThreadMessageId } = useThreadSidebar();
    const {
      composeRef,
      editingMessageId,
      handleArrowUpEdit,
      handleEditComplete
    } = useArrowUpEdit(messages);
    const historyRef = useRef<TMessageHistoryHandle>(null);
    const replyTarget = useMemo<TReplyTarget | undefined>(() => {
      if (!replyingToMessage) return undefined;
      if (replyingToMessage.pluginId)
        return { userId: null, pluginId: replyingToMessage.pluginId };
      return { userId: replyingToMessage.userId, pluginId: null };
    }, [replyingToMessage]);
    const onComposeResize = useCallback(() => {
      if (historyRef.current?.isAtBottom()) historyRef.current.scrollToBottom();
    }, []);
    const channelCan = useChannelCan(channelId);
    const sendTypingSignal = useTypingSignal(channelId);
    const onSend = useCallback(
      (message: string, files: TTempFile[]) => {
        const accepted = enqueueMessage({
          channelId,
          message,
          files,
          replyToMessageId: replyingToMessage?.id
        });
        if (accepted) {
          sendTypingSignal.cancel();
          setReplyingToMessage(undefined);
        }
        return accepted;
      },
      [channelId, replyingToMessage?.id, sendTypingSignal]
    );
    const onReplyMessageSelect = useCallback(
      (message: TJoinedMessage) => setReplyingToMessage(message),
      []
    );
    const handleReturnToPresent = useCallback(async () => {
      await returnToPresent();
      await nextFrame();
      await nextFrame();
      historyRef.current?.scrollToBottom();
    }, [returnToPresent]);
    const handleCancelReply = useCallback(
      () => setReplyingToMessage(undefined),
      []
    );

    if (!channelCan(ChannelPermission.VIEW_CHANNEL)) return <TextNoAccess />;

    return (
      <>
        <TextTopbar
          onScrollToMessage={scrollToMessage}
          channelId={channelId}
          dmPartnerId={dmPartnerId}
          onClose={onClose}
          onToggleRightSidebar={onToggleRightSidebar}
          isRightSidebarOpen={isRightSidebarOpen}
        />
        <MessageHistory
          ref={historyRef}
          channelId={channelId}
          messages={messages}
          loading={loading}
          fetching={fetching}
          hasMore={hasMore}
          loadMore={loadMore}
          detachedFromPresent={detachedFromPresent}
          onReplyMessageSelect={onReplyMessageSelect}
          replyTargetMessageId={replyingToMessage?.id}
          activeThreadMessageId={activeThreadMessageId}
          editingMessageId={editingMessageId}
          onEditComplete={handleEditComplete}
          components={historyComponents}
        />
        {detachedFromPresent && (
          <button
            type="button"
            onClick={handleReturnToPresent}
            data-testid={TestId.RETURN_TO_PRESENT}
            className="mx-2 mb-1 flex items-center justify-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 cursor-pointer"
          >
            <ArrowDownIcon className="size-3.5" />
            {t('viewingOlderMessages')}
          </button>
        )}
        <MessageCompose
          key={draftKey}
          ref={composeRef}
          channelId={channelId}
          draftKey={draftKey}
          onSend={onSend}
          onTyping={sendTypingSignal}
          typingUsers={typingUsers}
          dmPartnerName={channel?.isDm ? dmPartner?.name : undefined}
          showPluginSlot
          onCancelReply={handleCancelReply}
          replyTarget={replyTarget}
          onArrowUp={handleArrowUpEdit}
          onResize={onComposeResize}
        />
      </>
    );
  }
);

export { TextChannel };
