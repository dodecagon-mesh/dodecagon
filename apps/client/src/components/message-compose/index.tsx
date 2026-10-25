import { EmojiPicker } from '@/components/emoji-picker';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import type { TTiptapInputHandle } from '@/components/tiptap-input';
import { TiptapInput } from '@/components/tiptap-input';
import type { TEmojiItem } from '@/components/tiptap-input/helpers';

import type { MouseEvent as ReactMouseEvent } from 'react';

import { useChannelById } from '@/features/server/channels/hooks';
import {
  useCan,
  useChannelCan,
  usePublicServerSettings
} from '@/features/server/hooks';
import { useFlatPluginCommands } from '@/features/server/plugins/hooks';
import { useUploadFiles } from '@/hooks/use-upload-files';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { TReplyTarget } from '@/types';
import type { TJoinedPublicUser, TTempFile } from '@dodecagon/shared';
import {
  ChannelPermission,
  isEmptyMessage,
  MESSAGE_MAX_LENGTH,
  Permission,
  PluginSlot
} from '@dodecagon/shared';
import { Button } from '@dodecagon/ui';
import {
  ArrowUturnLeftIcon,
  FaceSmileIcon,
  PaperAirplaneIcon,
  PlusIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useMessageAuthorName } from '../channel-view/text/hooks/use-message-author-name';
import { PreviewFile } from '../channel-view/text/preview-file';
import {
  flushDraftMessages,
  getDraftMessage,
  setDraftMessage
} from '../channel-view/text/use-draft-messages';
import { UsersTypingIndicator } from '../channel-view/text/users-typing';

type TMessageComposeProps = {
  channelId: number;
  draftKey: string;
  onSend: (message: string, files: TTempFile[]) => boolean;
  onTyping: () => void;
  typingUsers: TJoinedPublicUser[];
  showPluginSlot?: boolean;

  replyTarget?: TReplyTarget;
  onCancelReply?: () => void;
  onArrowUp?: () => void;
  onResize?: () => void;
  isThread?: boolean;
  dmPartnerName?: string;
  ref?: Ref<TMessageComposeHandle>;
};

type TMessageComposeHandle = {
  focus: () => void;
};

const MessageCompose = memo(
  ({
    channelId,
    draftKey,
    onSend,
    onTyping,
    typingUsers,
    showPluginSlot = false,

    replyTarget,
    onCancelReply,
    onArrowUp,
    onResize,
    isThread = false,
    dmPartnerName,
    ref
  }: TMessageComposeProps) => {
    const { t } = useTranslation('common');
    const containerRef = useRef<HTMLDivElement | null>(null);
    const tiptapRef = useRef<TTiptapInputHandle>(null);
    const [message, setMessage] = useState(() => getDraftMessage(draftKey));
    const messageRef = useRef(message);
    const can = useCan();
    const channelCan = useChannelCan(channelId);
    const channel = useChannelById(channelId);
    const publicSettings = usePublicServerSettings();
    const allPluginCommands = useFlatPluginCommands();
    const replyAuthorName = useMessageAuthorName({
      userId: replyTarget?.userId ?? 0,
      pluginId: replyTarget?.pluginId ?? ''
    });

    const canSendMessages = useMemo(() => {
      return (
        can(Permission.SEND_MESSAGES) &&
        channelCan(ChannelPermission.SEND_MESSAGES)
      );
    }, [can, channelCan]);

    const canUploadFiles = useMemo(() => {
      const canShareFilesInDm =
        !channel?.isDm || !!publicSettings?.storageFileSharingInDirectMessages;

      return (
        can(Permission.SEND_MESSAGES) &&
        can(Permission.UPLOAD_FILES) &&
        channelCan(ChannelPermission.SEND_MESSAGES) &&
        canShareFilesInDm
      );
    }, [can, channelCan, channel, publicSettings]);

    const placeholder = useMemo(() => {
      if (isThread) {
        return t('replyInThreadPlaceholder');
      }

      if (channel && !channel.isDm) {
        return t('messageChannel', { name: channel.name });
      }

      if (channel?.isDm && dmPartnerName) {
        return t('messageUser', { name: dmPartnerName });
      }

      return t('typeAMessage');
    }, [channel, dmPartnerName, isThread, t]);

    const pluginCommands = useMemo(
      () => (can(Permission.USE_PLUGINS) ? allPluginCommands : undefined),
      [can, allPluginCommands]
    );

    const {
      files,
      displayItems,
      removeFile,
      clearFiles,
      uploading,
      openFileDialog,
      fileInputProps
    } = useUploadFiles(channelId, containerRef, !canSendMessages);

    useImperativeHandle(
      ref,
      () => ({ focus: () => tiptapRef.current?.focus() }),
      []
    );

    useEffect(() => flushDraftMessages, [draftKey]);

    const onMessageChange = useCallback(
      (value: string) => {
        messageRef.current = value;
        setMessage(value);
        setDraftMessage(draftKey, value);
      },
      [draftKey]
    );

    const handleSend = useCallback(() => {
      const message = messageRef.current;
      if (
        (isEmptyMessage(message) && !files.length) ||
        !canSendMessages ||
        uploading
      ) {
        return;
      }

      if (message.length > MESSAGE_MAX_LENGTH) {
        toast.error(t('messageTooLong', { max: MESSAGE_MAX_LENGTH }));

        return;
      }

      if (!onSend(message, files)) return;
      // ownership of these temporary files transfers to the immutable queued message
      clearFiles();
      tiptapRef.current?.clear();
      onMessageChange('');
      flushDraftMessages();
    }, [
      files,
      canSendMessages,
      uploading,
      onSend,
      clearFiles,
      onMessageChange,
      t
    ]);

    const focusInputOnBackdropClick = useCallback(
      (event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;

        tiptapRef.current?.focus();
      },
      []
    );

    const chatActionsProps = useMemo(() => ({ channelId }), [channelId]);

    // the previews keep the offset of the attach button and its gap, so they
    // stay aligned with the input area now that they sit above the controls
    const attachmentsClassName = 'ml-[46px] flex gap-1 flex-wrap px-4 pt-4';

    const insertEmoji = useCallback((emoji: TEmojiItem) => {
      tiptapRef.current?.insertEmoji(emoji);
    }, []);

    const onRemoveFileClick = useCallback(
      async (fileId: string) => {
        removeFile(fileId);

        const trpc = getTRPCClient();

        await trpc.files.deleteTemporary.mutate({ fileId }).catch(() => {});
      },
      [removeFile]
    );

    useEffect(() => {
      // focus the input when user clicks on reply
      if (replyTarget) {
        tiptapRef.current?.focus();
      }
    }, [replyTarget]);

    // TODO: check if this is really necessary
    useEffect(() => {
      if (!onResize) return;

      const el = containerRef.current;

      if (!el) return;

      const observer = new ResizeObserver(onResize);

      observer.observe(el);

      return () => observer.disconnect();
    }, [onResize, containerRef]);

    return (
      <div
        ref={containerRef}
        className={cn(
          'compose-container relative flex max-h-[35vh] shrink-0 flex-col gap-2 bg-canvas',
          isThread
            ? 'px-2 py-2'
            : 'px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]'
        )}
      >
        <UsersTypingIndicator typingUsers={typingUsers} />

        <div
          className={cn(
            'compose-scroll-row flex flex-1 cursor-text flex-col overflow-y-auto rounded-md bg-raised',
            isThread
              ? 'min-h-[44px] px-3 py-0 [&_.ProseMirror]:px-0! [&_.ProseMirror]:py-2.5! [&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-5! [&_.tiptap+div]:px-0! [&_.tiptap+div]:py-2.5! [&_.tiptap+div]:text-sm [&_.tiptap+div]:leading-5 [&_.tiptap+div]:text-muted-foreground'
              : 'min-h-[52px] px-4 [&_.ProseMirror]:px-0! [&_.ProseMirror]:py-4! [&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-5! [&_.tiptap+div]:px-0! [&_.tiptap+div]:py-4! [&_.tiptap+div]:text-sm [&_.tiptap+div]:leading-5 [&_.tiptap+div]:text-muted-foreground',
            uploading && 'bg-muted'
          )}
          onClick={focusInputOnBackdropClick}
        >
          {displayItems.length > 0 && (
            <div data-compose-attachments className={attachmentsClassName}>
              {displayItems.map((item) => (
                <PreviewFile
                  key={item.id}
                  item={item}
                  onRemove={
                    item.file
                      ? () => onRemoveFileClick(item.file!.id)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          <div data-compose-controls className="flex items-start gap-[14px]">
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'size-8 shrink-0 p-1.5 sticky top-2.5',
                // the thread surface uses a smaller vertical padding, so the
                // actions follow the text line instead of the surface padding
                isThread ? 'mt-1' : 'mt-2.5'
              )}
              aria-label={t('attachFiles')}
              disabled={uploading || !canUploadFiles}
              onClick={openFileDialog}
            >
              <PlusIcon className="size-5" />
            </Button>
            <div className="flex min-w-0 flex-1 flex-col">
              {replyTarget && (
                <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/40 mx-2 mt-3 px-2 py-1 text-xs">
                  <div className="min-w-0 flex items-center gap-1.5 text-muted-foreground">
                    <ArrowUturnLeftIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t('replyingTo', { username: replyAuthorName })}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0 p-[5px]"
                    onClick={onCancelReply}
                    title={t('cancelReply')}
                  >
                    <XMarkIcon className="size-3.5" />
                  </Button>
                </div>
              )}
              <TiptapInput
                ref={tiptapRef}
                value={message}
                placeholder={placeholder}
                onChange={onMessageChange}
                onSubmit={handleSend}
                onTyping={onTyping}
                onArrowUp={onArrowUp}
                disabled={!canSendMessages}
                commands={pluginCommands}
              />
            </div>

            <input {...fileInputProps} />
            <div
              className={cn(
                'flex shrink-0 items-start gap-2 sticky top-0',
                isThread ? 'pt-1' : 'pt-2.5'
              )}
            >
              {showPluginSlot && (
                <PluginSlotRenderer
                  slotId={PluginSlot.CHAT_ACTIONS}
                  props={chatActionsProps}
                />
              )}

              <EmojiPicker onEmojiSelect={insertEmoji}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 p-1.5"
                  aria-label={t('addEmoji')}
                  disabled={!canSendMessages}
                >
                  <FaceSmileIcon className="size-5" />
                </Button>
              </EmojiPicker>
              {(!isEmptyMessage(message) || displayItems.length > 0) && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 p-2"
                  aria-label={t('sendMessage')}
                  onClick={handleSend}
                  disabled={uploading || !canSendMessages}
                >
                  <PaperAirplaneIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export { MessageCompose, type TMessageComposeHandle };
