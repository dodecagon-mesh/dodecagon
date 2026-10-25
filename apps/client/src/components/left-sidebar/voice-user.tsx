import { UserAvatar } from '@/components/user-avatar';
import { useStreamVolumeControl } from '@/components/voice-provider/hooks/use-stream-volume-control';
import { useCan } from '@/features/server/hooks';
import type { TVoiceUser } from '@/features/server/types';
import { useIsOwnUser } from '@/features/server/users/hooks';
import { Permission, PluginSlot } from '@dodecagon/shared';
import { cn, HeadphonesOffIcon, MicOffIcon } from '@dodecagon/ui';
import { SpeakerXMarkIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PluginSlotRenderer } from '../plugin-slot-renderer';
import { UserPopover } from '../user-popover';
import { VOICE_USER_DND_MIME } from './helpers';
import { StreamContextMenu } from './stream-context-menu';

type TVoiceUserProps = {
  userId: number;
  channelId: number;
  user: TVoiceUser;
  isOwnChannel?: boolean;
};

const VoiceUser = memo(
  ({ user, channelId, isOwnChannel = false }: TVoiceUserProps) => {
    const { t } = useTranslation('common');
    const isOwnUser = useIsOwnUser(user.id);
    const { isMuted } = useStreamVolumeControl({
      type: 'user',
      userId: user.id
    });
    const can = useCan();
    const shouldShowMuteIndicator = isOwnChannel && !isOwnUser && isMuted;
    const canMove = !isOwnUser && can(Permission.MOVE_MEMBERS);

    const pluginSlotProps = useMemo(
      () => ({ channelId, userId: user.id }),
      [channelId, user.id]
    );

    const handleDragStart = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData(VOICE_USER_DND_MIME, String(user.id));
        e.dataTransfer.effectAllowed = 'move';
      },
      [user.id]
    );

    const userRow = (
      <div
        draggable={canMove}
        onDragStart={canMove ? handleDragStart : undefined}
        className={cn(
          'flex h-[30px] items-center gap-2 pl-[38px] pr-2.5 rounded hover:bg-accent/30 text-sm',
          canMove && 'cursor-grab active:cursor-grabbing'
        )}
      >
        <UserAvatar
          userId={user.id}
          className="size-[18px] shrink-0"
          showUserPopover={true}
          showStatusBadge={false}
        />

        <span className="flex-1 text-muted-foreground truncate text-xs">
          {user.name}
        </span>

        <PluginSlotRenderer
          slotId={PluginSlot.VOICE_USER_ROW}
          props={pluginSlotProps}
        />

        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {shouldShowMuteIndicator && (
            <SpeakerXMarkIcon className="h-3 w-3 text-red-500" />
          )}

          {user.state.micMuted && (
            <MicOffIcon className="h-3 w-3 text-red-500" />
          )}

          {user.state.soundMuted && (
            <HeadphonesOffIcon className="h-3 w-3 text-red-500" />
          )}

          {user.state.webcamEnabled && <VideoCameraIcon className="h-3 w-3" />}

          {user.state.sharingScreen && (
            <span className="rounded bg-danger-solid px-1.5 py-0.5 text-[10px] font-semibold leading-[14px] text-white">
              {t('live')}
            </span>
          )}
        </div>
      </div>
    );

    if (isOwnUser || !isOwnChannel) {
      return <UserPopover userId={user.id}>{userRow}</UserPopover>;
    }

    return (
      <StreamContextMenu type="user" userId={user.id} name={user.name}>
        <UserPopover userId={user.id}>{userRow}</UserPopover>
      </StreamContextMenu>
    );
  }
);

export { VoiceUser };
