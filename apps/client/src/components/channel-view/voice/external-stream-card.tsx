import { useVolumeControl } from '@/components/voice-provider/volume-control-context';
import {
  useShowUserBannersInVoice,
  useVoice
} from '@/features/server/voice/hooks';
import { cn } from '@/lib/utils';
import { StreamKind, type TExternalStream } from '@dodecagon/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  HeadphonesIcon
} from '@dodecagon/ui';
import { ServerStackIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { memo, useCallback } from 'react';
import { CardPinButton } from './card-pin-button';
import { CardTheme } from './card-theme';
import { cardBadgeClass, cardDensity } from './helpers';
import { useFullscreen } from './hooks/use-fullscreen';
import {
  PinnedCardType,
  type TPinnedCard
} from './hooks/use-pin-card-controller';
import { useScreenShareZoom } from './hooks/use-screen-share-zoom';
import { useVoiceRefs } from './hooks/use-voice-refs';
import { getStreamQualityMetadataLabel } from './quality-options';
import { VoiceCardContextMenu } from './voice-card-context-menu';

type TExternalStreamCardProps = {
  streamId: number;
  stream: TExternalStream;
  isPinned?: boolean;
  cardId: string;
  onPin: (card: TPinnedCard) => void;
  onUnpin: () => void;
  className?: string;
  showPinControls: boolean;
  isAnyCardPinned?: boolean;
};

const ExternalStreamCard = memo(
  ({
    streamId,
    stream,
    isPinned = false,
    cardId,
    onPin,
    onUnpin,
    className,
    showPinControls = true,
    isAnyCardPinned = false
  }: TExternalStreamCardProps) => {
    const { externalVideoRef, hasExternalVideoStream, hasExternalAudioStream } =
      useVoiceRefs(streamId, {
        pluginId: stream.pluginId,
        streamKey: stream.key
      });

    const { getVolume, getExternalVolumeKey } = useVolumeControl();

    const showUserBanners = useShowUserBannersInVoice();
    const { getStreamQuality, getStreamQualityLayers, isSimulcastConsumer } =
      useVoice();
    const volumeKey = getExternalVolumeKey(stream.pluginId, stream.key);
    const volume = getVolume(volumeKey);
    const isMuted = volume === 0;

    const isCompact = isAnyCardPinned && !isPinned;
    const density = cardDensity(isCompact);

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
          type: PinnedCardType.EXTERNAL_STREAM,
          userId: streamId
        });
      }
    }, [isPinned, onPin, onUnpin, cardId, streamId, resetZoom]);

    const hasVideo = stream.tracks?.video && hasExternalVideoStream;
    const hasAudio = stream.tracks?.audio && hasExternalAudioStream;

    const isSimulcastExternalVideoConsumer = isSimulcastConsumer(
      streamId,
      StreamKind.EXTERNAL_VIDEO
    );

    const qualityLayers = getStreamQualityLayers(
      streamId,
      StreamKind.EXTERNAL_VIDEO
    );

    const streamQuality = getStreamQuality(streamId, StreamKind.EXTERNAL_VIDEO);

    const qualityLabel = isSimulcastExternalVideoConsumer
      ? getStreamQualityMetadataLabel(streamQuality, qualityLayers)
      : null;

    return (
      <VoiceCardContextMenu
        volumeKey={hasAudio ? volumeKey : undefined}
        pictureInPicture={hasVideo ? { videoRef: externalVideoRef } : undefined}
        fullscreen={{ isFullscreen, onToggle: handleToggleFullscreen }}
        zoom={
          showPinControls && hasVideo && isPinned
            ? { isEnabled: isZoomEnabled, onToggle: handleToggleZoom }
            : undefined
        }
      >
        <div
          ref={containerRef}
          className={cn(
            'relative bg-card',
            'flex items-center justify-center',
            'size-full',
            isFullscreen
              ? 'rounded-none border-none'
              : 'rounded-[var(--voice-card-radius,12px)] overflow-hidden border-[length:var(--voice-card-border,1px)] border-border',
            (!isFullscreen || isOverlayVisible) && 'group/external-stream-card',
            className
          )}
          onWheel={hasVideo ? handleWheel : undefined}
          onMouseDown={hasVideo ? handleMouseDown : undefined}
          onMouseMove={hasVideo ? handleMouseMove : undefined}
          onMouseUp={hasVideo ? handleMouseUp : undefined}
          onMouseLeave={hasVideo ? handleMouseUp : undefined}
          style={{
            cursor:
              isFullscreen && !isOverlayVisible
                ? 'none'
                : hasVideo
                  ? getCursor()
                  : 'default'
          }}
        >
          {showPinControls && !isFullscreen && (
            <CardPinButton
              name={stream.title || 'External Stream'}
              isPinned={isPinned}
              onToggle={handlePinToggle}
            />
          )}
          {stream.bannerUrl && showUserBanners ? (
            <div
              className="h-full w-full rounded bg-cover bg-center blur-sm brightness-50 bg-no-repeat absolute inset-0"
              style={{
                backgroundImage: `url("${stream.bannerUrl}")`
              }}
            />
          ) : (
            <CardTheme />
          )}

          {hasVideo ? (
            <video
              ref={externalVideoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-contain bg-black"
              style={{
                transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out'
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 p-8">
              <div className="relative">
                {stream.avatarUrl ? (
                  <Avatar className="w-20 h-20 border-2 border-green-500/50">
                    <AvatarImage
                      src={stream.avatarUrl}
                      alt={stream.title || 'External Stream'}
                    />
                    <AvatarFallback className="bg-linear-to-br from-green-500/30 to-emerald-500/30">
                      <HeadphonesIcon className="size-10 text-green-400" />
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-linear-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center border-2 border-green-500/50">
                    <HeadphonesIcon className="size-10 text-green-400" />
                  </div>
                )}
                {hasAudio && !isMuted && (
                  <div className="absolute inset-0 rounded-full animate-pulse bg-green-500/20" />
                )}
              </div>
            </div>
          )}

          <div
            className={cn(
              'pointer-events-none absolute left-0 right-0 z-10',
              isFullscreen
                ? 'bottom-0'
                : 'bottom-[var(--voice-caption-bottom,0px)]',
              density.inset,
              'hidden group-hover/external-stream-card:flex'
            )}
          >
            <div className={cardBadgeClass(isCompact)}>
              {stream.avatarUrl ? (
                <img
                  src={stream.avatarUrl}
                  alt={stream.title || 'External Stream'}
                  className="size-4 shrink-0 rounded-full"
                />
              ) : (
                <ServerStackIcon className="size-3 text-purple-400 shrink-0" />
              )}
              {hasVideo && (
                <VideoCameraIcon className="size-3 text-blue-400 shrink-0" />
              )}
              {hasAudio && (
                <HeadphonesIcon
                  className={cn(
                    'size-3 shrink-0',
                    isMuted ? 'text-red-400' : 'text-green-400'
                  )}
                />
              )}
              <p className={cn('leading-none truncate', density.label)}>
                {stream.title || 'External Stream'}
                {(qualityLabel || stream.pluginId) && (
                  <span className="text-muted-foreground text-xs ml-2 leading-none">
                    {qualityLabel && `(${qualityLabel})`}
                    {qualityLabel && stream.pluginId && ' '}
                    {stream.pluginId && `via ${stream.pluginId}`}
                  </span>
                )}
                {isZoomEnabled && zoom > 1 && (
                  <span className="text-white/70 text-xs ml-2 leading-none">
                    {Math.round(zoom * 100)}%
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </VoiceCardContextMenu>
    );
  }
);

ExternalStreamCard.displayName = 'ExternalStreamCard';

export { ExternalStreamCard };
