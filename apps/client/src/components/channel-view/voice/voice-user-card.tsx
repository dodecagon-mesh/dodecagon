import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import { UserAvatar } from '@/components/user-avatar';
import { useDemoVisibility } from '@/components/voice-provider/demo-visibility-context';
import { useStreamVolumeControl } from '@/components/voice-provider/hooks/use-stream-volume-control';
import { useRemoteWebcamVisibility } from '@/components/voice-provider/remote-webcam-visibility-context';
import { useWebRtcSimulcastEnabled } from '@/features/server/hooks';
import type { TVoiceUser } from '@/features/server/types';
import { useIsOwnUser } from '@/features/server/users/hooks';
import {
  useShowUserBannersInVoice,
  useSpeakingState,
  useVoice
} from '@/features/server/voice/hooks';
import { getFileUrl } from '@/helpers/get-file-url';
import { cn } from '@/lib/utils';
import { PluginSlot, StreamKind } from '@dodecagon/shared';
import { HeadphonesOffIcon, MicOffIcon } from '@dodecagon/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CardPinButton } from './card-pin-button';
import { CardTheme } from './card-theme';
import {
  cardBadgeClass,
  cardControlClass,
  cardControlsClass,
  cardDensity
} from './helpers';
import { HideWebcamButton } from './hide-webcam-button';
import {
  PinnedCardType,
  type TPinnedCard
} from './hooks/use-pin-card-controller';
import { useVoiceRefs } from './hooks/use-voice-refs';
import { QualityButton } from './quality-button';
import { VoiceCardContextMenu } from './voice-card-context-menu';
import { VoiceReactions } from './voice-reactions';

type TVoiceUserCardProps = {
  userId: number;
  channelId: number;
  cardId: string;
  onPin: (card: TPinnedCard) => void;
  onUnpin: () => void;
  showPinControls?: boolean;
  voiceUser: TVoiceUser;
  className?: string;
  isPinned?: boolean;
  isAnyCardPinned?: boolean;
};

// focused size is inherited from the stage; grid and strip stay compact
const GRID_AVATAR_CLASS =
  'size-[var(--voice-avatar-size,80px)] [&_[data-slot=avatar-fallback]]:text-[length:calc(var(--voice-avatar-size,80px)_*_0.4)]';
const PINNED_AVATAR_CLASS =
  'size-[var(--voice-avatar-size,128px)] [&_[data-slot=avatar-fallback]]:text-[length:calc(var(--voice-avatar-size,128px)_*_0.4)]';
const COMPACT_AVATAR_CLASS =
  'size-[72px] [&_[data-slot=avatar-fallback]]:text-2xl';

const VoiceUserCard = memo(
  ({
    userId,
    channelId,
    cardId,
    onPin,
    onUnpin,
    className,
    isPinned = false,
    showPinControls = true,
    voiceUser,
    isAnyCardPinned = false
  }: TVoiceUserCardProps) => {
    const { t } = useTranslation('common');
    const { videoRef, hasVideoStream } = useVoiceRefs(userId);
    const { volumeKey } = useStreamVolumeControl({ type: 'user', userId });
    const { devices } = useDevices();
    const isOwnUser = useIsOwnUser(userId);
    const showUserBanners = useShowUserBannersInVoice();
    const webRtcSimulcastEnabled = useWebRtcSimulcastEnabled();
    const { isSimulcastConsumer } = useVoice();
    const { isActivelySpeaking, speakingIntensity } = useSpeakingState(userId);
    const speakingStyle = useMemo(() => {
      if (!isActivelySpeaking) return undefined;
      const intensity = Math.min(4, Math.max(1, speakingIntensity));
      const strength = 70 + (intensity - 1) * 10;
      return {
        boxShadow: `0 0 0 2px color-mix(in srgb, var(--color-success) ${strength}%, transparent)`
      };
    }, [isActivelySpeaking, speakingIntensity]);
    const { isWebcamHidden, toggleWebcamHidden } = useRemoteWebcamVisibility();
    const webcamHidden = isWebcamHidden(userId);
    const { isViewingDemo, stopViewingDemo } = useDemoVisibility();
    const handleToggleWebcam = useCallback(
      () => toggleWebcamHidden(userId),
      [toggleWebcamHidden, userId]
    );
    const handleStopWatching = useCallback(async () => {
      try {
        await stopViewingDemo(userId);
      } catch {
        toast.error(t('failedStopWatching'));
      }
    }, [stopViewingDemo, userId, t]);

    const isCompact = isAnyCardPinned && !isPinned;
    const density = cardDensity(isCompact);
    const showWebcamVideo =
      !devices.voiceOnlyMode && hasVideoStream && !webcamHidden;
    const showQualityControl =
      !isOwnUser && webRtcSimulcastEnabled && showWebcamVideo;
    let avatarClass = GRID_AVATAR_CLASS;
    if (isPinned) avatarClass = PINNED_AVATAR_CLASS;
    else if (isCompact) avatarClass = COMPACT_AVATAR_CLASS;

    const handlePinToggle = useCallback(() => {
      if (isPinned) {
        onUnpin?.();
      } else {
        onPin({ id: cardId, type: PinnedCardType.USER, userId: userId });
      }
    }, [isPinned, onPin, onUnpin, cardId, userId]);

    const pluginSlotProps = useMemo(
      () => ({ channelId, userId }),
      [channelId, userId]
    );

    const backgroundStyle = useMemo(
      () =>
        showWebcamVideo
          ? { backgroundColor: '#000000' }
          : { backgroundImage: `url("${getFileUrl(voiceUser.banner)}")` },
      [showWebcamVideo, voiceUser.banner]
    );

    return (
      <VoiceCardContextMenu
        volumeKey={isOwnUser ? undefined : volumeKey}
        pictureInPicture={showWebcamVideo ? { videoRef } : undefined}
        webcam={
          !isOwnUser && !devices.voiceOnlyMode && hasVideoStream
            ? {
                isHidden: webcamHidden,
                onToggle: handleToggleWebcam
              }
            : undefined
        }
        demo={
          !isOwnUser && !devices.voiceOnlyMode && voiceUser.state.sharingScreen
            ? {
                isViewing: isViewingDemo(userId),
                onToggle: handleStopWatching
              }
            : undefined
        }
      >
        <div
          className={cn(
            'relative overflow-hidden rounded-[var(--voice-card-radius,12px)] bg-panel group/voice-user-card',
            'flex items-center justify-center',
            'size-full',
            className
          )}
          style={speakingStyle}
        >
          {showPinControls && (
            <CardPinButton
              name={voiceUser.name}
              isPinned={isPinned}
              onToggle={handlePinToggle}
            />
          )}
          {voiceUser.banner && showUserBanners ? (
            <div
              className="absolute inset-0 h-full w-full bg-cover bg-center bg-no-repeat blur-sm brightness-50"
              style={backgroundStyle}
            />
          ) : (
            <CardTheme
              profileColor={voiceUser.profileColor}
              hasVideoStream={showWebcamVideo}
            />
          )}

          {!devices.voiceOnlyMode && hasVideoStream && (
            <video
              ref={videoRef}
              hidden={!showWebcamVideo}
              autoPlay
              muted
              playsInline
              className={cn(
                'absolute inset-0 w-full h-full object-contain',
                isOwnUser && devices.mirrorOwnVideo && '-scale-x-100'
              )}
            />
          )}
          {!showWebcamVideo && (
            <UserAvatar
              userId={userId}
              className={cn(
                'pointer-events-none [&_[data-slot=avatar-fallback]]:font-semibold',
                avatarClass
              )}
              showStatusBadge={false}
            />
          )}

          <VoiceReactions userId={userId} isCompact={isCompact} />

          <div
            className={cn(
              'absolute top-0 left-0 z-10 flex items-center gap-1',
              density.inset
            )}
          >
            <PluginSlotRenderer
              slotId={PluginSlot.VOICE_USER_CARD}
              props={pluginSlotProps}
            />
          </div>

          {!isOwnUser && !devices.voiceOnlyMode && hasVideoStream && (
            <div
              className={cn(
                'absolute top-0 right-0 z-10 justify-end',
                density.inset,
                'flex opacity-0 pointer-events-none group-hover/voice-user-card:opacity-100 group-hover/voice-user-card:pointer-events-auto group-focus-within/voice-user-card:opacity-100 group-focus-within/voice-user-card:pointer-events-auto',
                'has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:pointer-events-auto'
              )}
            >
              <div className={cardControlsClass(isCompact)}>
                {showQualityControl && (
                  <QualityButton
                    streamId={userId}
                    kind={StreamKind.VIDEO}
                    disabled={!isSimulcastConsumer(userId, StreamKind.VIDEO)}
                    size={density.icon}
                    className={cardControlClass()}
                  />
                )}
                {!isOwnUser && !devices.voiceOnlyMode && hasVideoStream && (
                  <HideWebcamButton
                    userId={userId}
                    size={density.icon}
                    className={cardControlClass(webcamHidden)}
                  />
                )}
              </div>
            </div>
          )}

          <div
            data-voice-caption
            className={cn(
              'pointer-events-none absolute bottom-[var(--voice-caption-bottom,0px)] left-0 right-0 z-[1] flex',
              density.inset
            )}
          >
            <div className={cardBadgeClass(isCompact)}>
              {voiceUser.state.micMuted && !voiceUser.state.soundMuted && (
                <MicOffIcon
                  className="text-red-400/80 shrink-0 size-3"
                  fill="currentColor"
                />
              )}
              {voiceUser.state.soundMuted && (
                <HeadphonesOffIcon
                  className="text-red-400/80 size-3"
                  fill="currentColor"
                />
              )}
              <p className={cn('truncate', density.label)}>{voiceUser.name}</p>
            </div>
          </div>
        </div>
      </VoiceCardContextMenu>
    );
  }
);

VoiceUserCard.displayName = 'VoiceUserCard';

export { VoiceUserCard };
