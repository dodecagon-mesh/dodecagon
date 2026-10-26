import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { Dialog } from '@/components/dialogs/dialogs';
import { UserAvatar } from '@/components/user-avatar';
import { useVoiceStats } from '@/components/voice-provider/stats-context';
import { openOverlay } from '@/features/overlays/actions';
import { useCurrentVoicePeers } from '@/features/server/hooks';
import { formatBigNumber } from '@/helpers/format-big-number';
import { cn } from '@/lib/utils';
import { NoiseSuppression } from '@/types';
import { TestId } from '@dodecagon/shared';
import {
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger
} from '@dodecagon/ui';
import { WrenchIcon } from '@heroicons/react/24/outline';
import { filesize } from 'filesize';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type StatsPopoverProps = {
  children: React.ReactNode;
};

const POPOVER_WIDTH = 264;

const hardwareEncoders = [
  'external',
  'hardware',
  'nvenc',
  'vaapi',
  'videotoolbox',
  'qsv',
  'amf',
  'mediacodec'
];

const softwareEncoders = ['libvpx', 'openh264', 'libaom', 'software'];

const NOISE_SUPPRESSION_LABEL_KEYS: Record<NoiseSuppression, string> = {
  [NoiseSuppression.NONE]: 'settings:noiseSuppressionNone',
  [NoiseSuppression.STANDARD]: 'settings:noiseSuppressionStandardName',
  [NoiseSuppression.RNNOISE]: 'settings:noiseSuppressionRnnoiseName',
  [NoiseSuppression.DTLN]: 'settings:noiseSuppressionDtlnName'
};

const getCodecLabel = (codec: string) => {
  const parts = codec.split('/');

  return parts.length > 1 ? parts[1] : codec;
};

type StatsLabelValueProps = {
  text?: string;
  label?: string;
  value?: React.ReactNode;
  valueClassName?: string;
};

const StatsLabelValue = memo(
  ({ text, label, value, valueClassName }: StatsLabelValueProps) => {
    let resolvedLabel = label;
    let resolvedValue = value;

    if (text) {
      const [textLabel, ...valueParts] = text.split(':');
      const textValue = valueParts.join(':').trim();

      if (!textValue) return text;

      resolvedLabel = textLabel;
      resolvedValue = textValue;
    }

    if (!resolvedLabel || resolvedValue === undefined) return null;

    return (
      <>
        <span className="text-muted-foreground">{resolvedLabel}:</span>{' '}
        <span className={valueClassName ?? 'text-foreground'}>
          {resolvedValue}
        </span>
      </>
    );
  }
);

StatsLabelValue.displayName = 'StatsLabelValue';

const ConnectionPing = ({
  value,
  control = false
}: {
  value: number | null | undefined;
  control?: boolean;
}) => {
  const { t, i18n } = useTranslation('sidebar');
  const available =
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const formatted = available
    ? `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)} ms`
    : '\u2014';
  return (
    <td
      className={cn(
        'p-0 pl-2 text-right align-middle text-[12px] font-semibold leading-[18px]',
        control || !available ? 'text-muted-foreground' : 'text-primary'
      )}
      title={t(control ? 'serverPingDescription' : 'peerPingDescription')}
    >
      {formatted}
    </td>
  );
};

const StatsPopover = memo(({ children }: StatsPopoverProps) => {
  const { t } = useTranslation('sidebar');
  const transportStats = useVoiceStats();
  const peers = useCurrentVoicePeers();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverAnchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const trigger = triggerRef.current;
          const dock = trigger?.closest('[data-voice-dock]');
          const reference =
            dock?.getBoundingClientRect() ??
            trigger?.getBoundingClientRect() ??
            new DOMRect();
          const sidebar =
            trigger
              ?.closest(`[data-testid="${TestId.LEFT_SIDEBAR}"]`)
              ?.getBoundingClientRect() ?? reference;
          return new DOMRect(
            sidebar.left + 8,
            reference.top,
            POPOVER_WIDTH,
            reference.height
          );
        },
        get contextElement() {
          return triggerRef.current?.closest('[data-voice-dock]') ?? undefined;
        }
      }
    }),
    []
  );
  const { devices } = useDevices();
  const [isOpen, setIsOpen] = useState(false);
  const [showSimulcastLayers, setShowSimulcastLayers] = useState(false);

  const {
    peerRtts,
    serverRtt,
    direct,
    producer,
    consumer,
    screenShare,
    totalBytesSent,
    totalBytesReceived,
    currentBitrateSent,
    currentBitrateReceived
  } = transportStats;

  const encoder = useMemo(() => {
    if (!screenShare?.encoderImplementation) return null;

    const lowerImpl = screenShare?.encoderImplementation.toLowerCase();

    if (hardwareEncoders.some((hw) => lowerImpl.includes(hw))) {
      return {
        label: t('gpuEncoder', { encoder: screenShare.encoderImplementation }),
        valueClassName: 'text-green-400'
      };
    }

    if (softwareEncoders.some((sw) => lowerImpl.includes(sw))) {
      return {
        label: t('cpuEncoder', { encoder: screenShare.encoderImplementation }),
        valueClassName: 'text-yellow-400'
      };
    }

    return {
      label: t('unknownEncoder', {
        encoder: screenShare.encoderImplementation
      }),
      valueClassName: undefined
    };
  }, [screenShare?.encoderImplementation, t]);

  const hasNoiseSuppression =
    devices.noiseSuppression !== NoiseSuppression.NONE;

  const noiseSuppressionLabel = t(
    NOISE_SUPPRESSION_LABEL_KEYS[devices.noiseSuppression]
  );

  const codec = useMemo(() => {
    return screenShare?.codec ? getCodecLabel(screenShare.codec) : undefined;
  }, [screenShare?.codec]);

  const handleOpenDiagnostics = useCallback(() => {
    setIsOpen(false);
    openOverlay({ kind: 'dialog', name: Dialog.VOICE_DEBUG });
  }, []);

  const handleToggleSimulcastLayers = useCallback(() => {
    setShowSimulcastLayers((show) => !show);
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild ref={triggerRef}>
        {children}
      </PopoverTrigger>
      {/* Register the custom anchor after Trigger so its initial anchor cannot replace it. */}
      <PopoverAnchor virtualRef={popoverAnchor} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={4}
        className="w-[264px] max-h-(--available-height) overflow-y-auto rounded-[10px] border border-line bg-panel p-1.5 text-[12px] text-foreground"
      >
        <div className="flex flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 p-2">
            <h3 className="text-sm font-semibold leading-5 text-foreground">
              {t('transportStats')}
            </h3>
            <IconButton
              className="size-6 p-[3px] [&_svg]:size-[18px]"
              variant="ghost"
              size="sm"
              icon={WrenchIcon}
              title={t('voiceDiagnostics')}
              aria-label={t('voiceDiagnostics')}
              onClick={handleOpenDiagnostics}
            />
          </div>
          <div className="flex w-full flex-col gap-1 border-t border-line px-2 py-1">
            <table
              className="w-[210px] table-fixed border-separate [border-spacing:0_4px]"
              aria-label={t('connection')}
            >
              <colgroup>
                <col className="w-[142px]" />
                <col className="w-[68px]" />
              </colgroup>
              <thead>
                <tr className="h-[18px] text-muted-foreground">
                  <th
                    scope="col"
                    className="p-0 text-left text-[12px] font-medium leading-[18px]"
                  >
                    {t('connection')}
                  </th>
                  <th
                    scope="col"
                    className="p-0 pl-2 text-right text-[12px] font-medium leading-[18px]"
                  >
                    {t('ping')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {peers.map((peer) => (
                  <tr key={peer.id} className="h-5">
                    <td className="p-0 align-middle text-[12px] leading-[18px] text-foreground">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="flex size-[18px] shrink-0 items-center justify-center"
                        >
                          <UserAvatar
                            userId={peer.id}
                            className="size-[18px]"
                            showStatusBadge={false}
                          />
                        </span>
                        <span className="truncate" title={peer.name}>
                          {peer.name}
                        </span>
                      </span>
                    </td>
                    <ConnectionPing value={peerRtts[peer.id]} />
                  </tr>
                ))}
                <tr className="h-5">
                  <td className="p-0 align-middle text-[12px] leading-[18px] text-foreground">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="size-[18px] shrink-0" />
                      <span className="truncate" title={t('serverControl')}>
                        {t('serverControl')}
                      </span>
                    </span>
                  </td>
                  <ConnectionPing value={serverRtt} control />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex w-full flex-col gap-1 border-t border-line p-2">
            <div className="flex h-[18px] w-full items-center gap-1.5 pl-[54px]">
              <span className="w-[75px] shrink-0 text-[12px] font-semibold leading-[18px] text-success">
                {t('outgoing')}
              </span>
              <span className="w-[75px] shrink-0 text-[12px] font-semibold leading-[18px] text-primary">
                {t('incoming')}
              </span>
            </div>
            <div className="grid h-[18px] w-full grid-cols-[48px_75px_75px] items-center gap-1.5 text-[12px] leading-[18px]">
              <span className="text-muted-foreground">{t('rateLabel')}</span>
              <span>
                {producer || direct
                  ? `${filesize(currentBitrateSent)}/s`
                  : '\u2014'}
              </span>
              <span>
                {consumer || direct
                  ? `${filesize(currentBitrateReceived)}/s`
                  : '\u2014'}
              </span>
            </div>
            <div className="grid h-[18px] w-full grid-cols-[48px_75px_75px] items-center gap-1.5 text-[12px] leading-[18px]">
              <span className="text-muted-foreground">{t('packetsLabel')}</span>
              <span>
                {producer || direct
                  ? formatBigNumber(
                      (producer?.packetsSent ?? 0) + (direct?.packetsSent ?? 0)
                    )
                  : '\u2014'}
              </span>
              <span>
                {consumer || direct
                  ? formatBigNumber(
                      (consumer?.packetsReceived ?? 0) +
                        (direct?.packetsReceived ?? 0)
                    )
                  : '\u2014'}
              </span>
            </div>
            <div className="grid h-[18px] w-full grid-cols-[48px_75px_75px] items-center gap-1.5 text-[12px] leading-[18px]">
              <span className="text-muted-foreground">{t('lostLabel')}</span>
              <span className="text-muted-foreground">{'\u2014'}</span>
              <span className="text-destructive">
                {consumer || direct
                  ? formatBigNumber(
                      (consumer?.packetsLost ?? 0) + (direct?.packetsLost ?? 0)
                    )
                  : '\u2014'}
              </span>
            </div>
          </div>

          {hasNoiseSuppression && (
            <div className="flex w-full flex-col gap-1.5 border-t border-line p-2">
              <h4 className="text-[13px] font-semibold leading-5 text-foreground">
                {t('microphone')}
              </h4>
              <div className="flex h-[18px] items-center gap-1.5 text-[12px] leading-[18px]">
                <StatsLabelValue
                  label={t('noiseSuppression')}
                  value={noiseSuppressionLabel}
                />
              </div>
            </div>
          )}

          {screenShare && (
            <div className="flex w-full flex-col gap-1 border-t border-line p-2">
              <h4 className="text-[13px] font-semibold leading-5 text-foreground">
                {t('screenShare')}
              </h4>
              <div className="space-y-1 text-[12px] leading-[18px]">
                {screenShare.codec && (
                  <div>
                    <StatsLabelValue text={t('codec', { codec })} />
                  </div>
                )}
                {encoder && (
                  <div>
                    <StatsLabelValue
                      label={t('encoder').replace(/:$/, '')}
                      value={encoder.label}
                      valueClassName={encoder.valueClassName}
                    />
                  </div>
                )}
                <div>
                  <StatsLabelValue
                    text={t('resolution', {
                      width: screenShare.width,
                      height: screenShare.height
                    })}
                  />
                </div>
                <div>
                  <StatsLabelValue
                    text={t('frameRate', {
                      fps: Math.round(screenShare.frameRate)
                    })}
                  />
                </div>
                <div>
                  <StatsLabelValue
                    text={t('bitrate', {
                      bitrate: filesize(screenShare.bitrate)
                    })}
                  />
                </div>
                {screenShare.simulcast && screenShare.layers.length > 1 && (
                  <div>
                    <button
                      className="text-left hover:underline"
                      type="button"
                      onClick={handleToggleSimulcastLayers}
                    >
                      <StatsLabelValue
                        text={t('simulcastLayers', {
                          count: screenShare.layers.length
                        })}
                      />
                    </button>
                    {showSimulcastLayers && (
                      <div className="mt-2 space-y-2">
                        {screenShare.layers.map((layer, index) => (
                          <div
                            key={layer.id}
                            className="space-y-1 rounded-md border border-border/50 p-2"
                          >
                            <div className="pb-1 font-medium text-foreground">
                              {t('simulcastLayer', {
                                layer: layer.rid || index + 1
                              })}
                              {layer.codec &&
                                ` (${getCodecLabel(layer.codec)})`}
                            </div>
                            <div>
                              <StatsLabelValue
                                text={t('resolution', {
                                  width: layer.width,
                                  height: layer.height
                                })}
                              />
                            </div>
                            <div>
                              <StatsLabelValue
                                text={t('frameRate', {
                                  fps: Math.round(layer.frameRate)
                                })}
                              />
                            </div>
                            <div>
                              <StatsLabelValue
                                text={t('bitrate', {
                                  bitrate: filesize(layer.bitrate)
                                })}
                              />
                            </div>
                            <div>
                              <StatsLabelValue
                                text={t('packets', {
                                  packets: formatBigNumber(layer.packetsSent)
                                })}
                              />
                            </div>
                            {layer.qualityLimitationReason !== 'none' && (
                              <div>
                                <StatsLabelValue
                                  text={t('qualityLimited', {
                                    reason: layer.qualityLimitationReason
                                  })}
                                  valueClassName="text-yellow-400"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <StatsLabelValue
                    text={t('framesEncoded', {
                      frames: formatBigNumber(screenShare.framesEncoded)
                    })}
                  />
                </div>
                {screenShare.qualityLimitationReason !== 'none' && (
                  <div>
                    <StatsLabelValue
                      text={t('qualityLimited', {
                        reason: screenShare.qualityLimitationReason
                      })}
                      valueClassName="text-yellow-400"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex w-full flex-col gap-1.5 border-t border-line p-2">
            <h4 className="text-[13px] font-semibold leading-5 text-foreground">
              {t('sessionTotals')}
            </h4>
            <div className="flex h-[18px] w-full gap-3 text-[12px] leading-[18px] text-foreground">
              <div className="flex flex-1 gap-1.5">
                <span className="text-muted-foreground">↑</span>
                {filesize(totalBytesSent)}
              </div>
              <div className="flex flex-1 gap-1.5">
                <span className="text-muted-foreground">↓</span>
                {filesize(totalBytesReceived)}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
});

export { StatsPopover };
