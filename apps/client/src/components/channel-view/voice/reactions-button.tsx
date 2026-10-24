import { Emoji } from '@/components/emoji';
import {
  EmojiPickerPanel,
  PICKER_PANEL_CONTENT_CLASS
} from '@/components/emoji-picker/picker-panel';
import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { QUICK_VOICE_REACTION_EMOJIS } from '@/features/server/voice/statics';
import { getTRPCClient } from '@/lib/trpc';
import { getTrpcError } from '@dodecagon/shared';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@dodecagon/ui';
import { FaceSmileIcon, PlusIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TReactionOptionProps = {
  emoji: string;
  onSelect: (emoji: string) => void;
};

const ReactionOption = memo(({ emoji, onSelect }: TReactionOptionProps) => {
  const handleClick = useCallback(() => onSelect(emoji), [onSelect, emoji]);

  return (
    <button
      type="button"
      className="size-8 flex items-center justify-center rounded transition-transform hover:scale-125 cursor-pointer"
      onClick={handleClick}
      aria-label={emoji}
    >
      <Emoji
        emoji={emoji}
        file={null}
        className="size-5"
        nativeEmojiClassName="text-xl leading-none"
      />
    </button>
  );
});

ReactionOption.displayName = 'ReactionOption';

const ReactionsButton = memo(() => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [showAllEmojis, setShowAllEmojis] = useState(false);

  const sendReaction = useCallback(
    async (emoji: string) => {
      setOpen(false);

      const trpc = getTRPCClient();

      try {
        await trpc.voice.sendReaction.mutate({ emoji });
      } catch (error) {
        toast.error(getTrpcError(error, t('failedSendVoiceReaction')));
      }
    },
    [t]
  );

  const handlePickerSelect = useCallback(
    (emoji: TEmojiItem) => {
      sendReaction(emoji.shortcodes[0]);
    },
    [sendReaction]
  );

  const handleExpand = useCallback(() => setShowAllEmojis(true), []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);

    if (nextOpen) setShowAllEmojis(false);
  }, []);

  const contentClass = showAllEmojis
    ? PICKER_PANEL_CONTENT_CLASS
    : 'w-auto p-1.5';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip content={t('sendVoiceReaction')}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-[7px] bg-transparent text-white transition-colors duration-150 hover:bg-white/10 hover:text-white max-[360px]:size-9"
            aria-label={t('sendVoiceReaction')}
          >
            <FaceSmileIcon className="size-5" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className={contentClass} align="center" sideOffset={12}>
        {showAllEmojis ? (
          <EmojiPickerPanel onEmojiSelect={handlePickerSelect} />
        ) : (
          <div className="flex items-center gap-0.5">
            {QUICK_VOICE_REACTION_EMOJIS.map((emoji) => (
              <ReactionOption
                key={emoji}
                emoji={emoji}
                onSelect={sendReaction}
              />
            ))}

            <div className="mx-1 h-6 border-r border-border" />

            <Tooltip content={t('moreVoiceReactions')}>
              <button
                type="button"
                className="size-8 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                onClick={handleExpand}
                aria-label={t('moreVoiceReactions')}
              >
                <PlusIcon className="size-4" />
              </button>
            </Tooltip>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});

ReactionsButton.displayName = 'ReactionsButton';

export { ReactionsButton };
