import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { ServerScreen } from '@/components/server-screens/screens';
import { openOverlay } from '@/features/overlays/actions';
import { TestId } from '@dodecagon/shared';
import {
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider
} from '@dodecagon/ui';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

type TAudioSettingsMenuProps = {
  kind: 'microphone' | 'output';
  children: ReactNode;
};

// the popup keeps the width of the voice status block and opens 142px above
// the bottom of the sidebar, so it grows over the channel list instead of the
// voice status block or the user toolbar
const POPOVER_WIDTH = 236;
const POPOVER_BOTTOM_OFFSET = 142;

const AudioSettingsMenu = memo(
  ({ kind, children }: TAudioSettingsMenuProps) => {
    const { t } = useTranslation('audio');
    const { t: settingsT } = useTranslation('settings');
    const { devices, inputDevices, playbackDevices, saveDevices } =
      useDevices();
    const [open, setOpen] = useState(false);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const restoreFocusRef = useRef(true);
    const volumeLabelId = useId();
    const isMicrophone = kind === 'microphone';
    const deviceKey = isMicrophone ? 'microphoneId' : 'playbackId';
    const volumeKey = isMicrophone ? 'microphoneVolume' : 'playbackVolume';
    const availableDevices = isMicrophone ? inputDevices : playbackDevices;
    const volumeLabel = t(isMicrophone ? 'microphoneVolume' : 'outputVolume');
    const title = t(isMicrophone ? 'microphoneSettings' : 'outputSettings');
    const deviceLabel = t(isMicrophone ? 'inputDevice' : 'outputDevice');
    const defaultLabel = settingsT(
      isMicrophone ? 'defaultMicrophone' : 'defaultOutput'
    );
    const hasDefault = availableDevices.some(
      (device) => device?.deviceId === 'default'
    );

    // the menu opens from the sidebar like the connection stats one, so it
    // never reaches over the edge of the screen
    const popoverAnchor = useMemo(
      () => ({
        current: {
          getBoundingClientRect: () => {
            const trigger = anchorRef.current;
            const reference = trigger?.getBoundingClientRect() ?? new DOMRect();
            const sidebarElement = trigger?.closest(
              `[data-testid="${TestId.LEFT_SIDEBAR}"]`
            );

            // the dock trigger opens at the fixed anchor of the network stats,
            // the stage trigger keeps opening right above its own button
            if (!sidebarElement) {
              return new DOMRect(
                reference.left + 8,
                reference.top,
                POPOVER_WIDTH,
                reference.height
              );
            }

            const sidebar = sidebarElement.getBoundingClientRect();

            return new DOMRect(
              sidebar.left + 8,
              sidebar.bottom - POPOVER_BOTTOM_OFFSET,
              POPOVER_WIDTH,
              0
            );
          },
          get contextElement() {
            return anchorRef.current ?? undefined;
          }
        }
      }),
      []
    );

    const handleContextMenu = useCallback((event: MouseEvent) => {
      event.preventDefault();
      restoreFocusRef.current = true;
      setOpen(true);
    }, []);
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
      if (
        event.key === 'ContextMenu' ||
        (event.shiftKey && event.key === 'F10')
      ) {
        event.preventDefault();
        event.stopPropagation();
        restoreFocusRef.current = true;
        setOpen(true);
      }
    }, []);
    const handleCloseAutoFocus = useCallback((event: Event) => {
      event.preventDefault();
      if (restoreFocusRef.current) {
        const button = anchorRef.current?.querySelector('button');
        button?.focus();
      }
    }, []);
    const handleInteractOutside = useCallback(() => {
      restoreFocusRef.current = false;
    }, []);

    const handleDeviceChange = useCallback(
      (value: string) => {
        // Removing an option can emit null; it is not a new user preference.
        if (!value) return;
        saveDevices((current) => ({ ...current, [deviceKey]: value }));
      },
      [deviceKey, saveDevices]
    );
    const handleVolumeChange = useCallback(
      ([value]: number[]) => {
        saveDevices((current) => ({ ...current, [volumeKey]: value }));
      },
      [volumeKey, saveDevices]
    );
    const handleVoiceSettings = useCallback(() => {
      restoreFocusRef.current = false;
      setOpen(false);
      openOverlay({
        kind: 'serverScreen',
        name: ServerScreen.USER_SETTINGS,
        props: {
          initialEntryId: 'devices'
        }
      });
    }, []);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span
            ref={anchorRef}
            className="inline-flex shrink-0"
            // the anchor carries the open state for the surrounding controls bar
            data-popup-open={open ? '' : undefined}
            onContextMenu={handleContextMenu}
            onKeyDown={handleKeyDown}
          >
            {children}
          </span>
        </PopoverAnchor>
        <PopoverAnchor virtualRef={popoverAnchor} />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={4}
          onCloseAutoFocus={handleCloseAutoFocus}
          onInteractOutside={handleInteractOutside}
          aria-label={title}
          className="w-[236px] max-h-(--available-height) overflow-y-auto rounded-[10px] border border-line bg-panel p-1.5 text-[12px] text-foreground"
        >
          <div className="flex flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 p-2">
              <h3 className="text-sm font-semibold leading-5 text-foreground">
                {title}
              </h3>
              <IconButton
                className="size-6 p-[3px] [&_svg]:size-[18px]"
                variant="ghost"
                size="sm"
                icon={Cog6ToothIcon}
                title={t('voiceSettings')}
                aria-label={t('voiceSettings')}
                onClick={handleVoiceSettings}
              />
            </div>
            <div className="flex w-full flex-col border-t border-line">
              <Select
                value={devices[deviceKey] ?? 'default'}
                onValueChange={handleDeviceChange}
              >
                <SelectTrigger
                  aria-label={deviceLabel}
                  className="h-auto w-full gap-2 rounded-none border-0 bg-transparent p-2 text-left shadow-none hover:bg-raised [&>svg]:-rotate-90"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[13px] font-semibold leading-5 text-foreground">
                      {deviceLabel}
                    </span>
                    <span className="truncate text-[12px] leading-[18px] text-muted-foreground">
                      <SelectValue placeholder={defaultLabel} />
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {!hasDefault && (
                    <SelectItem value="default">{defaultLabel}</SelectItem>
                  )}
                  {availableDevices.map(
                    (device) =>
                      device &&
                      device.deviceId && (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
                          {device.label.trim() || defaultLabel}
                        </SelectItem>
                      )
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full flex-col gap-2 border-t border-line p-2">
              <div className="flex items-center justify-between gap-3 text-[12px] leading-[18px]">
                <span
                  id={volumeLabelId}
                  className="text-[13px] font-semibold leading-5 text-foreground"
                >
                  {volumeLabel}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {devices[volumeKey]}%
                </span>
              </div>
              <Slider
                aria-label={volumeLabel}
                aria-labelledby={volumeLabelId}
                min={0}
                max={100}
                step={1}
                value={[devices[volumeKey]]}
                onValueChange={handleVolumeChange}
                className="h-5 [&_[data-slot=slider-track]]:h-1"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);

export { AudioSettingsMenu };
