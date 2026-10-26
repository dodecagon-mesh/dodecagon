import { EmojiPicker } from '@/components/emoji-picker';
import { useRecentEmojis } from '@/components/emoji-picker/use-recent-emojis';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import { Protect } from '@/components/protect';
import {
  shouldUseFallbackImage,
  withoutShadowedEmojis,
  type TEmojiItem
} from '@/components/tiptap-input/helpers';
import { openThreadSidebar } from '@/features/app/actions';
import { useIsShiftHeld } from '@/features/app/hooks';
import { requestConfirmation } from '@/features/overlays/actions';
import { useCustomEmojis } from '@/features/server/emojis/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { Permission, PluginSlot } from '@dodecagon/shared';
import { IconButton } from '@dodecagon/ui';
import {
  ArrowUturnLeftIcon,
  BookmarkIcon,
  BookmarkSlashIcon,
  ChatBubbleLeftRightIcon,
  FaceSmileIcon,
  PencilIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const MAX_QUICK_EMOJIS = 4;

type TMessageActionsProps = {
  messageId: number;
  channelId: number;
  onEdit: () => void;
  onReply?: () => void;
  canManage: boolean;
  editable: boolean;
  isThreadReply?: boolean;
  isPinned?: boolean;
  disablePin?: boolean;
};

type TQuickReactionButtonProps = {
  emoji: TEmojiItem;
  onSelect: (emoji: TEmojiItem) => void;
};

const QuickReactionButton = memo(
  ({ emoji, onSelect }: TQuickReactionButtonProps) => {
    const handleClick = useCallback(() => onSelect(emoji), [onSelect, emoji]);

    return (
      <button
        type="button"
        onClick={handleClick}
        className="w-6 h-6 flex items-center justify-center hover:bg-accent rounded-md transition-colors text-md"
        title={`:${emoji.shortcodes[0]}:`}
      >
        {emoji.emoji && !shouldUseFallbackImage(emoji) ? (
          <span>{emoji.emoji}</span>
        ) : emoji.fallbackImage ? (
          <img
            src={emoji.fallbackImage}
            alt={emoji.name}
            className="w-5 h-5 object-contain"
          />
        ) : (
          <span>{emoji.name}</span>
        )}
      </button>
    );
  }
);

const MessageActions = memo(
  ({
    onEdit,
    messageId,
    channelId,
    canManage,
    editable,
    isThreadReply,
    isPinned,
    disablePin,
    onReply
  }: TMessageActionsProps) => {
    const { t } = useTranslation();
    const { recentEmojis } = useRecentEmojis();
    const customEmojis = useCustomEmojis();

    // a built-in picked before a custom emoji took its name would show itself
    // but react with the custom one
    const recentEmojisToShow = useMemo(() => {
      const reachableEmojis = withoutShadowedEmojis(recentEmojis, customEmojis);

      return reachableEmojis.slice(0, MAX_QUICK_EMOJIS);
    }, [recentEmojis, customEmojis]);

    const isShiftHeld = useIsShiftHeld();

    const pluginProps = useMemo(
      () => ({ messageId, channelId }),
      [messageId, channelId]
    );

    const onDeleteClick = useCallback(async () => {
      if (!isShiftHeld) {
        const choice = await requestConfirmation({
          title: t('deleteMessageTitle'),
          message: t('deleteMessageConfirm'),
          confirmLabel: t('deleteLabel'),
          cancelLabel: t('cancel'),
          variant: 'danger'
        });

        if (!choice) return;
      }

      const trpc = getTRPCClient();
      try {
        await trpc.messages.delete.mutate({ messageId });
        toast.success(t('messageDeleted'));
      } catch {
        toast.error(t('failedDeleteMessage'));
      }
    }, [isShiftHeld, messageId, t]);

    const onEmojiSelect = useCallback(
      async (emoji: TEmojiItem) => {
        const trpc = getTRPCClient();

        try {
          await trpc.messages.toggleReaction.mutate({
            messageId,
            emoji: emoji.shortcodes[0]
          });
        } catch (error) {
          toast.error(t('failedAddReaction'));

          console.error('Error adding reaction:', error);
        }
      },
      [messageId, t]
    );

    const onReplyClick = useCallback(() => {
      openThreadSidebar(messageId, channelId);
    }, [messageId, channelId]);

    const onPinClick = useCallback(async () => {
      const trpc = getTRPCClient();

      try {
        await trpc.messages.togglePin.mutate({ messageId });

        toast.success(t('messagePinToggled'));
      } catch (error) {
        toast.error(t('failedTogglePin'));

        console.error('Error toggling pin status:', error);
      }
    }, [messageId, t]);

    return (
      <div
        data-message-actions
        className="absolute right-0 -top-6 z-10 hidden group-hover:flex [&:has([data-popup-open])]:flex items-center gap-0.5 rounded-lg shadow-lg border border-border p-1 transition-all bg-background"
      >
        <Protect permission={Permission.REACT_TO_MESSAGES}>
          {recentEmojisToShow.length > 0 && (
            <div className="flex items-center gap-0.5 border-r pr-0.5">
              {recentEmojisToShow.map((emoji) => (
                <QuickReactionButton
                  key={emoji.name}
                  emoji={emoji}
                  onSelect={onEmojiSelect}
                />
              ))}
            </div>
          )}

          <EmojiPicker onEmojiSelect={onEmojiSelect}>
            <IconButton
              size="sm"
              variant="ghost"
              icon={FaceSmileIcon}
              title={t('addReaction')}
            />
          </EmojiPicker>
        </Protect>

        {onReply && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={ArrowUturnLeftIcon}
            onClick={onReply}
            title={t('replyToMessage')}
          />
        )}
        {!isThreadReply && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={ChatBubbleLeftRightIcon}
            onClick={onReplyClick}
            title={t('replyInThread')}
          />
        )}
        {canManage && (
          <>
            <IconButton
              size="sm"
              variant="ghost"
              icon={PencilIcon}
              onClick={onEdit}
              disabled={!editable}
              title={t('editMessage')}
            />

            <IconButton
              size="sm"
              variant="ghost"
              icon={isShiftHeld ? TrashIcon : TrashIcon}
              className={isShiftHeld ? 'text-destructive' : ''}
              onClick={onDeleteClick}
              title={t('deleteMessageTitle')}
            />
          </>
        )}
        {!disablePin && (
          <Protect permission={Permission.PIN_MESSAGES}>
            <IconButton
              size="sm"
              variant="ghost"
              icon={isPinned ? BookmarkSlashIcon : BookmarkIcon}
              onClick={onPinClick}
              title={isPinned ? t('unpinMessage') : t('pinMessage')}
            />
          </Protect>
        )}

        <PluginSlotRenderer
          slotId={PluginSlot.MESSAGE_ACTIONS}
          props={pluginProps}
        />
      </div>
    );
  }
);

export { MessageActions };
