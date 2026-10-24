import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { useDemoVisibility } from '@/components/voice-provider/demo-visibility-context';
import { useVoiceStats } from '@/components/voice-provider/stats-context';
import { useVolumeControl } from '@/components/voice-provider/volume-control-context';
import { useWebRtcSimulcastEnabled } from '@/features/server/hooks';
import { useOwnUserId, useUserById } from '@/features/server/users/hooks';
import { useVoice } from '@/features/server/voice/hooks';
import { useStreamQualityData } from '@/hooks/use-stream-quality-data';
import { cn } from '@/lib/utils';
import { StreamKind } from '@dodecagon/shared';
import { PlayIcon } from '@heroicons/react/20/solid';
import { ComputerDesktopIcon } from '@heroicons/react/24/outline';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CardPinButton } from './card-pin-button';
import { CardTheme } from './card-theme';
import { cardControlClass, cardControlsClass, cardDensity } from './helpers';
import { useFullscreen } from './hooks/use-fullscreen';
import {
  PinnedCardType,
  type TPinnedCard
} from './hooks/use-pin-card-controller';
import { useScreenShareZoom } from './hooks/use-screen-share-zoom';
import { useVideoStats } from './hooks/use-video-stats';
import { useVoiceRefs } from './hooks/use-voice-refs';
import { QualityButton } from './quality-button';
import { VoiceCardContextMenu } from './voice-card-context-menu';

type TScreenShareCardProps = {
  userId: number;
  isPinned?: boolean;
  cardId: string;
  onPin: (card: TPinnedCard) => void;
  onUnpin: () => void;
  className?: string;
  showPinControls: boolean;
  isAnyCardPinned?: boolean;
};

const SCREEN_SHARE_SHELL_CLASS =
  'relative flex size-full items-center justify-center overflow-hidden rounded-[var(--voice-card-radius,12px)] border-[length:var(--voice-card-border,1px)] border-line';
const SCREEN_SHARE_CAPTION_CLASS =
  'pointer-events-none absolute bottom-[max(8px,var(--voice-caption-bottom,0px))] left-2 z-[1] flex h-6.5 max-w-[calc(100%-16px)] items-center gap-2 rounded-[6px] px-2';

const ScreenShareCard = memo(
  ({
    userId,
    isPinned = false,
    cardId,
    onPin,
    onUnpin,
    className,
    showPinControls = true,
    isAnyCardPinned = false
  }: TScreenShareCardProps) => {
    const { t } = useTranslation('common');
    const user = useUserById(userId);
    const ownUserId = useOwnUserId();
    const { devices } = useDevices();
    const { isViewingDemo, viewDemo, stopViewingDemo } = useDemoVisibility();
    const [watchState, setWatchState] = useState<'idle' | 'loading' | 'error'>(
      'idle'
    );
    const watchRequest = useRef(0);
    const automaticResume = useRef(false);
    useEffect(
      () => () => {
        watchRequest.current++;
      },
      [userId]
    );
    const handleWatch = useCallback(async () => {
      const request = ++watchRequest.current;
      automaticResume.current = false;
      setWatchState('loading');
      try {
        await viewDemo(userId);
        if (request !== watchRequest.current || !isViewingDemo(userId)) return;
        if (showPinControls)
          onPin({ id: cardId, type: PinnedCardType.SCREEN_SHARE, userId });
        // Media arrival, not the RPC completing, ends the loading state.
      } catch {
        if (request !== watchRequest.current) return;
        // Roll back the provider's optimistic opt-in before offering a retry.
        try {
          await stopViewingDemo(userId);
        } catch {
          /* Still allow retry. */
        }
        if (request === watchRequest.current) setWatchState('error');
      }
    }, [
      viewDemo,
      stopViewingDemo,
      userId,
      isViewingDemo,
      showPinControls,
      onPin,
      cardId
    ]);
    const { getUserScreenVolumeKey } = useVolumeControl();
    const isOwnUser = ownUserId === userId;
    const webRtcSimulcastEnabled = useWebRtcSimulcastEnabled();
    const volumeKey = getUserScreenVolumeKey(userId);

    const isCompact = isAnyCardPinned && !isPinned;
    const density = cardDensity(isCompact);

    const {
      screenShareRef,
      screenShareAudioRef,
      hasScreenShareStream,
      hasScreenShareAudioStream
    } = useVoiceRefs(userId, undefined, isOwnUser || isViewingDemo(userId));

    const viewing = isOwnUser || isViewingDemo(userId);
    useEffect(() => {
      if (isOwnUser) return;
      if (viewing && !hasScreenShareStream && watchState === 'idle') {
        automaticResume.current = true;
        setWatchState('loading');
      } else if (!viewing && watchState === 'loading') {
        automaticResume.current = false;
        setWatchState('idle');
      }
    }, [isOwnUser, viewing, hasScreenShareStream, watchState]);
    useEffect(() => {
      if (viewing && hasScreenShareStream && watchState !== 'idle') {
        automaticResume.current = false;
        setWatchState('idle');
        return;
      }
      if (watchState !== 'loading') return;
      const timer = setTimeout(() => {
        watchRequest.current++;
        if (!automaticResume.current) {
          void stopViewingDemo(userId).catch(() => {});
        }
        setWatchState('error');
      }, 15_000);
      return () => clearTimeout(timer);
    }, [watchState, viewing, hasScreenShareStream, stopViewingDemo, userId]);

    const { getConsumerCodec } = useVoice();
    const transportStats = useVoiceStats();

    const videoStats = useVideoStats(screenShareRef, hasScreenShareStream);

    const codec = useMemo(() => {
      let mimeType: string | undefined;

      if (isOwnUser) {
        mimeType = transportStats.screenShare?.codec;
      } else {
        mimeType = getConsumerCodec(userId, StreamKind.SCREEN);
      }

      if (!mimeType) return null;

      const parts = mimeType.split('/');

      return parts.length > 1 ? parts[1] : mimeType;
    }, [
      isOwnUser,
      transportStats.screenShare?.codec,
      getConsumerCodec,
      userId
    ]);

    const { isSimulcastScreenConsumer, qualityLabel } = useStreamQualityData(
      userId,
      StreamKind.SCREEN
    );

    const {
      containerRef,
      isZoomEnabled,
      zoom,
      position,
      isDragging,
      handleToggleZoom,
      handleWheel,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      getCursor,
      resetZoom
    } = useScreenShareZoom();

    const { isFullscreen, isOverlayVisible, toggleFullscreen } =
      useFullscreen(containerRef);

    const handleToggleFullscreen = useCallback(() => {
      resetZoom();
      toggleFullscreen();
    }, [resetZoom, toggleFullscreen]);

    const handlePinToggle = useCallback(() => {
      if (isPinned) {
        onUnpin?.();
        resetZoom();
      } else {
        onPin({
          id: cardId,
          type: PinnedCardType.SCREEN_SHARE,
          userId: userId
        });
      }
    }, [isPinned, onPin, onUnpin, cardId, userId, resetZoom]);

    const handleStopWatching = useCallback(async () => {
      watchRequest.current++;
      setWatchState('idle');
      if (isPinned) onUnpin();
      resetZoom();
      try {
        await stopViewingDemo(userId);
      } catch {
        toast.error(t('failedStopWatching'));
      }
    }, [stopViewingDemo, userId, isPinned, onUnpin, resetZoom, t]);

    if (!user || devices.voiceOnlyMode) return null;

    let watchLabel = t('watchStream');
    let watchAccessibleLabel = t('watchScreen', { name: user.name });
    if (watchState === 'loading') {
      watchLabel = t('connectingStream');
      watchAccessibleLabel = watchLabel;
    } else if (watchState === 'error') {
      watchLabel = t('retryWatching', { name: user.name });
      watchAccessibleLabel = watchLabel;
    }

    if (!isOwnUser && (!isViewingDemo(userId) || !hasScreenShareStream)) {
      return (
        <VoiceCardContextMenu
          demo={{ isViewing: viewing, onToggle: handleStopWatching }}
        >
          <div
            data-screen-share-card
            className={cn(SCREEN_SHARE_SHELL_CLASS, 'bg-nav', className)}
          >
            <button
              type="button"
              onClick={handleWatch}
              disabled={watchState === 'loading'}
              aria-busy={watchState === 'loading'}
              aria-label={watchAccessibleLabel}
              className="absolute inset-0 z-1 flex cursor-pointer items-center justify-center rounded-[inherit] text-[13px] leading-5 text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
            >
              <span className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-raised px-4 text-sm font-medium leading-5 text-foreground">
                <PlayIcon aria-hidden="true" className="size-4" />
                <span>{watchLabel}</span>
              </span>
            </button>
            {watchState === 'error' && (
              <p
                role="alert"
                className="absolute top-2.5 inset-x-2.5 text-center text-xs text-foreground"
              >
                {t('unableWatchStream')}
              </p>
            )}
            <div className={cn(SCREEN_SHARE_CAPTION_CLASS, 'text-foreground')}>
              <ComputerDesktopIcon
                aria-hidden="true"
                className="size-[18px] shrink-0"
              />
              <p className="truncate text-[13px] font-medium leading-[17px]">
                {user.name}'s screen
              </p>
            </div>
          </div>
        </VoiceCardContextMenu>
      );
    }

    if (!hasScreenShareStream) return null;

    return (
      <VoiceCardContextMenu
        volumeKey={
          !isOwnUser && hasScreenShareAudioStream ? volumeKey : undefined
        }
        pictureInPicture={{ videoRef: screenShareRef }}
        fullscreen={{ isFullscreen, onToggle: handleToggleFullscreen }}
        zoom={
          showPinControls && isPinned
            ? { isEnabled: isZoomEnabled, onToggle: handleToggleZoom }
            : undefined
        }
        demo={
          !isOwnUser
            ? {
                isViewing: isViewingDemo(userId),
                onToggle: handleStopWatching
              }
            : undefined
        }
      >
        <div
          ref={containerRef}
          data-screen-share-card
          className={cn(
            SCREEN_SHARE_SHELL_CLASS,
            'bg-black group/screen-share-card',
            isFullscreen && 'rounded-none border-none',
            className
          )}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: isFullscreen && !isOverlayVisible ? 'none' : getCursor()
          }}
        >
          {showPinControls && !isFullscreen && (
            <CardPinButton
              name={user.name}
              isPinned={isPinned}
              onToggle={handlePinToggle}
            />
          )}
          <CardTheme />

          <video
            ref={screenShareRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 size-full bg-black object-contain"
            style={{
              transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
          />

          <audio
            ref={screenShareAudioRef}
            className="hidden"
            autoPlay
            playsInline
          />

          {!isOwnUser && webRtcSimulcastEnabled && (
            <div
              className={cn(
                'absolute top-0 right-0 z-10 justify-end',
                density.inset,
                'flex opacity-0 pointer-events-none group-hover/screen-share-card:opacity-100 group-hover/screen-share-card:pointer-events-auto group-focus-within/screen-share-card:opacity-100 group-focus-within/screen-share-card:pointer-events-auto',
                'has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:pointer-events-auto'
              )}
            >
              <div className={cardControlsClass(isCompact)}>
                <QualityButton
                  streamId={userId}
                  kind={StreamKind.SCREEN}
                  disabled={!isSimulcastScreenConsumer}
                  size={density.icon}
                  className={cardControlClass()}
                />
              </div>
            </div>
          )}

          <div
            className={cn(
              SCREEN_SHARE_CAPTION_CLASS,
              'bg-black/65 text-white',
              isFullscreen && 'bottom-2'
            )}
          >
            <ComputerDesktopIcon
              aria-hidden="true"
              className="size-[18px] shrink-0"
            />
            <p className="truncate text-[13px] font-medium leading-[17px]">
              {user.name}'s screen
              {(videoStats || codec) && (
                <span className="ml-2 text-xs leading-4 text-white/80">
                  {codec}
                  {codec && videoStats && ' '}
                  {videoStats && (
                    <>
                      {videoStats.width}x{videoStats.height}
                      {videoStats.frameRate > 0 &&
                        ` ${videoStats.frameRate}fps`}
                    </>
                  )}
                  {(codec || videoStats) && qualityLabel && ' '}
                  {qualityLabel && `(${qualityLabel})`}
                </span>
              )}
              {isZoomEnabled && zoom > 1 && (
                <span className="ml-2 text-xs leading-none text-white/80">
                  {Math.round(zoom * 100)}%
                </span>
              )}
            </p>
          </div>
        </div>
      </VoiceCardContextMenu>
    );
  }
);

ScreenShareCard.displayName = 'ScreenShareCard';

export { ScreenShareCard };
