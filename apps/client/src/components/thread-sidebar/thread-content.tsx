import { PendingMessages } from '@/components/message-compose/pending-messages';
import { useThreadSidebar } from '@/features/app/hooks';
import { useTypingUsersByThreadId } from '@/features/server/hooks';
import {
  useParentMessage,
  useThreadMessages
} from '@/features/server/messages/hooks';

import type { TJoinedMessage } from '@dodecagon/shared';
import { Spinner } from '@dodecagon/ui';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useArrowUpEdit } from '../channel-view/text/hooks/use-arrow-up-edit';
import {
  MessageHistory,
  type TMessageHistoryHandle
} from '../channel-view/text/message-history';
import { ParentMessagePreview } from './parent-message-preview';
import { ThreadCompose } from './thread-compose';
import { ThreadHeader } from './thread-header';

type TThreadContentProps = {
  parentMessageId: number;
  channelId: number;
};

const HISTORY_COMPONENTS = { Footer: PendingMessages };

const ThreadContent = memo(
  ({ parentMessageId, channelId }: TThreadContentProps) => {
    const { t } = useTranslation('common');
    const { messages, hasMore, loadMore, loading, fetching } =
      useThreadMessages(parentMessageId);
    const [replyingToMessage, setReplyingToMessage] = useState<
      TJoinedMessage | undefined
    >();
    const { activeThreadMessageId } = useThreadSidebar();
    const parentMessage = useParentMessage(parentMessageId, channelId);
    const replyCount = parentMessage?.replyCount ?? 0;
    const {
      composeRef,
      editingMessageId,
      handleArrowUpEdit,
      handleEditComplete
    } = useArrowUpEdit(messages);

    const typingUsers = useTypingUsersByThreadId(parentMessageId);

    const historyRef = useRef<TMessageHistoryHandle>(null);

    const onComposeResize = useCallback(() => {
      if (historyRef.current?.isAtBottom()) {
        historyRef.current.scrollToBottom();
      }
    }, []);

    const onReplyMessageSelect = useCallback((message: TJoinedMessage) => {
      setReplyingToMessage(message);
    }, []);

    const handleCancelReply = useCallback(
      () => setReplyingToMessage(undefined),

      [setReplyingToMessage]
    );

    return (
      <div className="flex flex-col h-full w-full">
        <ThreadHeader channelId={channelId} />
        <ParentMessagePreview messageId={parentMessageId} />

        {replyCount > 0 && (
          <div
            data-thread-reply-count
            className="flex shrink-0 items-center gap-3 px-6 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground"
          >
            <span>{t('reply', { count: replyCount })}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
              {fetching && (
                <div className="h-8 flex items-center justify-center shrink-0">
                  <Spinner size="xs" />
                </div>
              )}

              <MessageHistory
                key={parentMessageId}
                ref={historyRef}
                channelId={channelId}
                parentMessageId={parentMessageId}
                compact
                messages={messages}
                loading={loading}
                fetching={fetching}
                hasMore={hasMore}
                loadMore={loadMore}
                components={HISTORY_COMPONENTS}
                onReplyMessageSelect={onReplyMessageSelect}
                replyTargetMessageId={replyingToMessage?.id}
                activeThreadMessageId={activeThreadMessageId}
                editingMessageId={editingMessageId}
                onEditComplete={handleEditComplete}
              />
            </>
          )}

          <ThreadCompose
            ref={composeRef}
            parentMessageId={parentMessageId}
            channelId={channelId}
            typingUsers={typingUsers}
            replyingToMessage={replyingToMessage}
            onCancelReply={handleCancelReply}
            onArrowUp={handleArrowUpEdit}
            onResize={onComposeResize}
          />
        </div>
      </div>
    );
  }
);

export { ThreadContent };
