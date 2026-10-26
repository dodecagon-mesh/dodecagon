import { ServerScreen } from '@/components/server-screens/screens';
import { openVoiceChatSidebar } from '@/features/app/actions';
import { openOverlay } from '@/features/overlays/actions';
import { useCan } from '@/features/server/hooks';
import { Permission } from '@dodecagon/shared';
import { IconButton } from '@dodecagon/ui';
import { ChatBubbleLeftIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getVoiceChannelActions } from './helpers';

type TVoiceChannelActionsProps = {
  channelId: number;
};

const ChatAction = memo(({ channelId }: TVoiceChannelActionsProps) => {
  const { t } = useTranslation('sidebar');

  // the action opens the chat of the channel, it must not reach the row of the
  // channel, that would join the voice channel
  const onChatClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      openVoiceChatSidebar(channelId);
    },
    [channelId]
  );

  return (
    <IconButton
      variant="ghost"
      size="sm"
      icon={ChatBubbleLeftIcon}
      onClick={onChatClick}
      aria-label={t('openChat')}
    />
  );
});

const SettingsAction = memo(({ channelId }: TVoiceChannelActionsProps) => {
  const { t } = useTranslation('sidebar');

  // the settings of the channel open without connecting to the voice channel,
  // so the click must not reach the row of the channel
  const onSettingsClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      openOverlay({
        kind: 'serverScreen',
        name: ServerScreen.CHANNEL_SETTINGS,
        props: { channelId }
      });
    },
    [channelId]
  );

  return (
    <IconButton
      variant="ghost"
      size="sm"
      icon={Cog6ToothIcon}
      onClick={onSettingsClick}
      aria-label={t('configureChannel')}
    />
  );
});

// the actions of a voice channel replace its context menu, they stay hidden
// until the row is hovered or one of them is focused
const VoiceChannelActions = memo(({ channelId }: TVoiceChannelActionsProps) => {
  const can = useCan();

  const canEditChannel = can([
    Permission.MANAGE_CHANNELS,
    Permission.MANAGE_CHANNEL_PERMISSIONS
  ]);

  const actions = getVoiceChannelActions(canEditChannel);

  return (
    <div className="absolute right-2.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
      {actions.map((action) => {
        if (action === 'chat') {
          return <ChatAction key={action} channelId={channelId} />;
        }

        return <SettingsAction key={action} channelId={channelId} />;
      })}
    </div>
  );
});

export { VoiceChannelActions };
