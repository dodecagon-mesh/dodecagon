import {
  useVolumeControl,
  type TVolumeKey
} from '@/components/voice-provider/volume-control-context';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Slider
} from '@dodecagon/ui';
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  EyeSlashIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  Square2StackIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon
} from '@heroicons/react/24/outline';
import {
  memo,
  useCallback,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePictureInPicture } from './hooks/use-picture-in-picture';

type TVoiceCardContextMenuProps = {
  children: ReactNode;
  volumeKey?: TVolumeKey;
  pictureInPicture?: {
    videoRef: RefObject<HTMLVideoElement | null>;
  };
  fullscreen?: {
    isFullscreen: boolean;
    onToggle: () => void;
  };
  zoom?: {
    isEnabled: boolean;
    onToggle: () => void;
  };
  webcam?: {
    isHidden: boolean;
    onToggle: () => void;
  };
  demo?: {
    isViewing: boolean;
    onToggle: () => void;
  };
};

const VoiceCardContextMenu = memo(
  ({
    children,
    volumeKey,
    pictureInPicture,
    fullscreen,
    zoom,
    webcam,
    demo
  }: TVoiceCardContextMenuProps) => {
    const { t } = useTranslation('common');
    const { getVolume, setVolume, toggleMute } = useVolumeControl();
    const sliderRef = useRef<HTMLSpanElement>(null);
    const volume = volumeKey === undefined ? 100 : getVolume(volumeKey);
    const isMuted = volume === 0;
    const handleVolumeChange = useCallback(
      ([value]: number[]) => {
        if (volumeKey !== undefined && value !== undefined)
          setVolume(volumeKey, value);
      },
      [volumeKey, setVolume]
    );
    const handleVolumeSelect = useCallback((event: Event) => {
      event.preventDefault();
      // the base ui thumb holds the focusable range input
      const thumb = sliderRef.current?.querySelector<HTMLElement>(
        'input[type="range"]'
      );
      thumb?.focus();
    }, []);
    const handleSliderKeyDown = useCallback((event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab')
        event.stopPropagation();
    }, []);
    const handleSliderClick = useCallback((event: MouseEvent) => {
      event.stopPropagation();
    }, []);
    // the mute checkbox keeps the menu open, so the volume stays adjustable
    const handleMuteSelect = useCallback((event: Event) => {
      event.preventDefault();
    }, []);
    const handleMuteCheckedChange = useCallback(
      (checked: boolean) => {
        if (volumeKey === undefined) return;
        if (checked === isMuted) return;
        toggleMute(volumeKey);
      },
      [volumeKey, isMuted, toggleMute]
    );
    const fallbackVideoRef = useRef<HTMLVideoElement>(null);
    const { isSupported, isActive, togglePictureInPicture } =
      usePictureInPicture(
        pictureInPicture?.videoRef ?? fallbackVideoRef,
        !!pictureInPicture
      );

    const showPip = !!pictureInPicture && isSupported;

    const hasItems =
      volumeKey !== undefined ||
      showPip ||
      !!fullscreen ||
      !!zoom ||
      !!webcam ||
      !!demo?.isViewing;
    // Resolving picture-in-picture support must not remount the media player.

    return (
      <ContextMenu disabled={!hasItems}>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-66 rounded-[10px] border-line bg-panel p-1.5 text-foreground [&_[data-slot=context-menu-item]]:min-h-9 [&_[data-slot=context-menu-item]]:p-2">
          {demo?.isViewing && (
            <ContextMenuItem onSelect={demo.onToggle}>
              <EyeSlashIcon />
              {t('stopWatching')}
            </ContextMenuItem>
          )}
          {volumeKey !== undefined && (
            <ContextMenuItem
              onSelect={handleVolumeSelect}
              className="flex-col items-stretch gap-2 focus:bg-transparent"
            >
              <div className="flex items-center justify-between leading-5">
                <span>{t('volume')}</span>
                <span className="text-[13px] text-muted-foreground">
                  {volume}%
                </span>
              </div>
              <Slider
                ref={sliderRef}
                aria-label={t('volume')}
                value={[volume]}
                min={0}
                max={100}
                step={1}
                onValueChange={handleVolumeChange}
                onKeyDown={handleSliderKeyDown}
                onClick={handleSliderClick}
                className="h-5 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-thumb]]:size-4"
              />
            </ContextMenuItem>
          )}
          {volumeKey !== undefined && (
            <ContextMenuCheckboxItem
              checked={isMuted}
              onCheckedChange={handleMuteCheckedChange}
              onSelect={handleMuteSelect}
              className="[&>span:first-child]:rounded-xs [&>span:first-child]:border [&>span:first-child]:border-muted-foreground data-[checked]:[&>span:first-child]:border-primary data-[checked]:[&>span:first-child]:bg-primary data-[checked]:[&>span:first-child]:text-primary-foreground"
            >
              {t('muteStream')}
            </ContextMenuCheckboxItem>
          )}
          {zoom && (
            <ContextMenuItem onSelect={zoom.onToggle}>
              {zoom.isEnabled ? (
                <MagnifyingGlassMinusIcon />
              ) : (
                <MagnifyingGlassPlusIcon />
              )}
              {zoom.isEnabled ? t('disableZoom') : t('enableZoom')}
            </ContextMenuItem>
          )}
          {webcam && (
            <ContextMenuItem onSelect={webcam.onToggle}>
              {webcam.isHidden ? <VideoCameraIcon /> : <VideoCameraSlashIcon />}
              {webcam.isHidden ? t('showWebcam') : t('hideWebcam')}
            </ContextMenuItem>
          )}
          {showPip && (
            <ContextMenuItem onSelect={togglePictureInPicture}>
              <Square2StackIcon />
              {isActive ? t('exitPictureInPicture') : t('pictureInPicture')}
            </ContextMenuItem>
          )}
          {fullscreen && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={fullscreen.onToggle}>
                {fullscreen.isFullscreen ? (
                  <ArrowsPointingInIcon />
                ) : (
                  <ArrowsPointingOutIcon />
                )}
                {fullscreen.isFullscreen
                  ? t('exitFullscreen')
                  : t('fullscreen')}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }
);

VoiceCardContextMenu.displayName = 'VoiceCardContextMenu';

export { VoiceCardContextMenu };
