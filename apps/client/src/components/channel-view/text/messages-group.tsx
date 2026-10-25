import { PluginAvatar } from '@/components/plugin-avatar';
import { RelativeTime } from '@/components/relative-time';
import { UserAvatar } from '@/components/user-avatar';
import { usePluginMetadata } from '@/features/server/plugins/hooks';
import { useUserById } from '@/features/server/users/hooks';
import { cn } from '@/lib/utils';
import {
  DELETED_USER_IDENTITY_AND_NAME,
  type TJoinedMessage
} from '@dodecagon/shared';
import { format, isValid } from 'date-fns';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { areGroupsEqual } from './helpers';
import { useMessageAuthorName } from './hooks/use-message-author-name';
import { Message } from './message';
import { MessageReplyPreviewWrapper } from './message-reply-preview-wrapper';

type TMessagesGroupProps = {
  showClockTime?: boolean;
  group: TJoinedMessage[];
  disableActions?: boolean;
  disableFiles?: boolean;
  disableReactions?: boolean;
  onReplyMessageSelect?: (message: TJoinedMessage) => void;
  replyTargetMessageId?: number;
  activeThreadMessageId?: number;
  editingMessageId?: number;
  onEditComplete?: () => void;
  compact?: boolean;
  continuation?: boolean;
  continues?: boolean;
};

const MessagesGroup = memo(
  ({
    showClockTime = false,
    group,
    disableActions,
    disableFiles,
    disableReactions,
    onReplyMessageSelect,
    replyTargetMessageId,
    activeThreadMessageId,
    editingMessageId,
    onEditComplete,
    compact = false,
    continuation = false,
    continues = false
  }: TMessagesGroupProps) => {
    const { t } = useTranslation('common');
    const firstMessage = group[0];
    const pluginMetadata = usePluginMetadata(firstMessage.pluginId);
    const user = useUserById(firstMessage.userId);
    const date = new Date(firstMessage.createdAt);
    const hasValidDate = isValid(date);
    const authorName = useMessageAuthorName(firstMessage);
    const isDeletedUser = user?.name === DELETED_USER_IDENTITY_AND_NAME;
    const isPluginMessage = !!firstMessage.pluginId;

    const isReplyToMessage =
      group.length === 1 && !!firstMessage.replyToMessageId;

    const groupContent = (
      <div
        data-message-group={!continuation || undefined}
        className={cn(
          'flex min-w-0 max-w-dvw gap-4 py-2 select-text',
          compact &&
            'gap-3 py-1.5 [&_.msg-content]:text-[14px]! [&_.msg-content]:leading-[22px]! [&_[data-slot=avatar]]:size-7!',
          continuation && 'pt-0',
          continues && 'pb-0'
        )}
      >
        {continuation && (
          <div
            aria-hidden
            className={compact ? 'w-7 shrink-0' : 'w-[38px] shrink-0'}
          />
        )}
        {!continuation &&
          (isPluginMessage ? (
            <PluginAvatar
              name={pluginMetadata?.name}
              avatarUrl={pluginMetadata?.avatarUrl}
              className={compact ? 'size-7' : 'h-[38px] w-[38px]'}
            />
          ) : (
            <UserAvatar
              userId={user!.id}
              className={compact ? 'size-7' : 'h-[38px] w-[38px]'}
              showUserPopover
            />
          ))}
        <div className="flex min-w-0 flex-col gap-1 w-full">
          {!continuation && (
            <div className="flex gap-[9px] items-baseline">
              <span
                className={cn(
                  'text-sm font-semibold leading-5',
                  isDeletedUser && 'line-through text-muted-foreground',
                  isPluginMessage && 'text-accent-text'
                )}
              >
                {authorName}
              </span>
              {isPluginMessage && (
                <span className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-text uppercase tracking-wide">
                  bot
                </span>
              )}
              {showClockTime && hasValidDate && (
                <time
                  className="text-subtle-foreground text-xs leading-4"
                  dateTime={date.toISOString()}
                  title={format(date, 'PPpp')}
                >
                  {format(date, 'h:mm a')}
                </time>
              )}
              {showClockTime && !hasValidDate && (
                <span className="text-subtle-foreground text-xs leading-4">
                  {t('unknownTime')}
                </span>
              )}
              {!showClockTime && hasValidDate && (
                <RelativeTime date={date}>
                  {(relativeTime) => (
                    <span
                      className="text-subtle-foreground text-xs"
                      title={format(date, 'PPpp')}
                    >
                      {relativeTime}
                    </span>
                  )}
                </RelativeTime>
              )}
              {!showClockTime && !hasValidDate && (
                <span className="text-subtle-foreground text-xs">
                  {t('unknownTime')}
                </span>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col">
            {group.map((message) => (
              <div
                key={message.id}
                id={`message-${message.id}`}
                className="rounded-md transition-colors duration-1000"
              >
                <Message
                  message={message}
                  disableActions={disableActions}
                  disableFiles={disableFiles}
                  disableReactions={disableReactions}
                  onReplyMessageSelect={onReplyMessageSelect}
                  isInlineReplyTarget={message.id === replyTargetMessageId}
                  isActiveThread={message.id === activeThreadMessageId}
                  editingMessageId={editingMessageId}
                  onEditComplete={onEditComplete}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    );

    if (isReplyToMessage) {
      return (
        <MessageReplyPreviewWrapper message={firstMessage}>
          {groupContent}
        </MessageReplyPreviewWrapper>
      );
    }

    return groupContent;
  },
  areGroupsEqual
);

export { MessagesGroup };
