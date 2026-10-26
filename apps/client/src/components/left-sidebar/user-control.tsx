import { AudioSettingsMenu } from '@/components/audio-settings-menu';
import { useShortcutHint } from '@/components/hotkeys-controller/use-shortcut-hint';
import { openOverlay } from '@/features/overlays/actions';
import { useCurrentVoiceChannelId } from '@/features/server/channels/hooks';
import { useChannelCan } from '@/features/server/hooks';
import { useOwnPublicUser } from '@/features/server/users/hooks';
import { useVoice } from '@/features/server/voice/hooks';
import { cn } from '@/lib/utils';
import { ChannelPermission, TestId } from '@dodecagon/shared';
import {
  Button,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicOffIcon
} from '@dodecagon/ui';
import { Cog6ToothIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerScreen } from '../server-screens/screens';
import { UserAvatar } from '../user-avatar';
import { UserPopover } from '../user-popover';

type TAvatarDrag = {
  element: HTMLSpanElement;
  pointerId: number;
  startX: number;
  startY: number;
  dragged: boolean;
  reducedMotion: MediaQueryList;
};

const UserControl = memo(() => {
  const { t } = useTranslation(['sidebar', 'keybindings']);
  const ownPublicUser = useOwnPublicUser();
  const currentVoiceChannelId = useCurrentVoiceChannelId();
  const { ownVoiceState, toggleMic, toggleSound } = useVoice();
  const avatarDrag = useRef<TAvatarDrag | null>(null);
  const avatarReturn = useRef<Animation | null>(null);
  const suppressAvatarClick = useRef(false);

  useEffect(
    () => () => {
      avatarReturn.current?.cancel();
      const drag = avatarDrag.current;
      avatarDrag.current = null;
      if (!drag) return;
      drag.element.style.transform = '';
      if (drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
    },
    []
  );

  const finishAvatarDrag = useCallback(
    (event: PointerEvent<HTMLSpanElement>) => {
      const drag = avatarDrag.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      avatarDrag.current = null;
      const transform = drag.element.style.transform;
      drag.element.style.transform = '';
      if (drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
      if (
        event.type !== 'pointerup' ||
        !drag.dragged ||
        drag.reducedMotion.matches
      ) {
        return;
      }
      const animation = drag.element.animate(
        [{ transform }, { transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.18)' }
      );
      avatarReturn.current = animation;
      animation.onfinish = () => {
        if (avatarReturn.current === animation) avatarReturn.current = null;
      };
    },
    []
  );

  const microphoneLabel = t(
    ownVoiceState.micMuted ? 'keybindings:unmuteMic' : 'keybindings:muteMic'
  );
  const soundLabel = t(
    ownVoiceState.soundMuted ? 'keybindings:undeafen' : 'keybindings:deafen'
  );
  const microphoneHint = useShortcutHint('mute', microphoneLabel);
  const soundHint = useShortcutHint('deafen', soundLabel);
  const settingsHint = useShortcutHint('settings', t('userSettings'));
  const channelCan = useChannelCan(currentVoiceChannelId);
  const microphoneDisabled =
    !channelCan(ChannelPermission.SPEAK) || ownVoiceState.soundMuted;
  const handleSettingsClick = useCallback(() => {
    openOverlay({ kind: 'serverScreen', name: ServerScreen.USER_SETTINGS });
  }, []);

  if (!ownPublicUser) return null;

  return (
    <div className="flex h-[52px] w-full shrink-0 items-center gap-1.5 bg-rail px-2.5">
      <UserPopover userId={ownPublicUser.id}>
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onPointerDownCapture={(event) => {
            if (event.isPrimary && event.button === 0) {
              suppressAvatarClick.current = false;
            }
          }}
          onClickCapture={(event) => {
            if (event.detail > 0 && suppressAvatarClick.current) {
              event.preventDefault();
              event.stopPropagation();
            }
            suppressAvatarClick.current = false;
          }}
        >
          <span
            className="relative size-8 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (
                !event.isPrimary ||
                event.button !== 0 ||
                avatarDrag.current
              ) {
                return;
              }
              avatarReturn.current?.cancel();
              avatarReturn.current = null;
              event.currentTarget.style.transform = '';
              avatarDrag.current = {
                element: event.currentTarget,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                dragged: false,
                reducedMotion: window.matchMedia(
                  '(prefers-reduced-motion: reduce)'
                )
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = avatarDrag.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const x = event.clientX - drag.startX;
              const y = event.clientY - drag.startY;
              if (!drag.dragged && x * x + y * y < 16) return;
              drag.dragged = true;
              suppressAvatarClick.current = true;
              event.preventDefault();
              if (drag.reducedMotion.matches) {
                drag.element.style.transform = '';
                return;
              }
              const offsetX = Math.max(-4, Math.min(4, x * 0.14));
              const offsetY = Math.max(-4, Math.min(4, y * 0.14));
              const tiltX = Math.max(-12, Math.min(12, -y * 0.5));
              const tiltY = Math.max(-12, Math.min(12, x * 0.5));
              const rotation = Math.max(-8, Math.min(8, x * 0.3));
              drag.element.style.transform = `translate(${offsetX}px, ${offsetY}px) perspective(120px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotate(${rotation}deg)`;
            }}
            onPointerUp={finishAvatarDrag}
            onPointerCancel={finishAvatarDrag}
            onLostPointerCapture={finishAvatarDrag}
          >
            <UserAvatar
              userId={ownPublicUser.id}
              className="size-8 shrink-0"
              showUserPopover={false}
              statusBadgeClassName="right-px bottom-px size-[9px] border-accent"
            />
          </span>
          <div className="flex h-[30px] min-w-0 flex-1 flex-col justify-center gap-px">
            <span className="truncate text-[13px] font-semibold leading-4 text-foreground">
              {ownPublicUser.name}
            </span>
            <span className="truncate text-xs leading-4 text-muted-foreground capitalize">
              {ownPublicUser.status}
            </span>
          </div>
        </button>
      </UserPopover>

      <div className="flex shrink-0 items-center gap-1.5">
        <AudioSettingsMenu kind="microphone">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-8 rounded-[6px] p-0',
              microphoneDisabled && 'opacity-60',
              ownVoiceState.micMuted
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400'
                : 'text-muted-foreground hover:bg-raised hover:text-foreground'
            )}
            onClick={microphoneDisabled ? undefined : toggleMic}
            title={microphoneHint}
            aria-label={microphoneLabel}
            aria-description={microphoneHint}
            aria-disabled={microphoneDisabled || undefined}
          >
            {ownVoiceState.micMuted ? (
              <MicOffIcon className="size-5" />
            ) : (
              <MicrophoneIcon className="size-5" />
            )}
          </Button>
        </AudioSettingsMenu>
        <AudioSettingsMenu kind="output">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-8 rounded-[6px] p-0',
              ownVoiceState.soundMuted
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400'
                : 'text-muted-foreground hover:bg-raised hover:text-foreground'
            )}
            onClick={toggleSound}
            title={soundHint}
            aria-label={soundLabel}
            aria-description={soundHint}
          >
            {ownVoiceState.soundMuted ? (
              <HeadphonesOffIcon className="size-5" />
            ) : (
              <HeadphonesIcon className="size-5" />
            )}
          </Button>
        </AudioSettingsMenu>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-[6px] p-0 text-muted-foreground hover:bg-raised hover:text-foreground"
          data-testid={TestId.USER_SETTINGS_TRIGGER}
          onClick={handleSettingsClick}
          title={settingsHint}
          aria-description={settingsHint}
          aria-label={t('userSettings')}
        >
          <Cog6ToothIcon className="size-5" />
        </Button>
      </div>
    </div>
  );
});

export { UserControl };
