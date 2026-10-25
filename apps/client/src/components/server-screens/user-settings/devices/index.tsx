import { useDevices } from '@/components/devices-provider/hooks/use-devices';
import { SettingsSection } from '@/components/server-screens/settings-shell/section';
import { useSettingsForm } from '@/components/server-screens/settings-shell/use-settings-form';
import { getVoiceControlsBridge } from '@/components/voice-provider/controls-bridge';
import { useCurrentVoiceChannelId } from '@/features/server/channels/hooks';
import { usePublicServerSettings } from '@/features/server/hooks';
import { useOwnVoiceState } from '@/features/server/voice/hooks';
import { MICROPHONE_GATE_DEFAULT_THRESHOLD_DB } from '@/helpers/audio-gate';
import {
  getNoiseGateWorkletAvailabilitySnapshot,
  subscribeNoiseGateWorkletAvailability
} from '@/helpers/audio-worklet/noise-gate-worklet';
import {
  getRestrictOwnAudioSupport,
  getSuppressLocalAudioPlaybackSupport
} from '@/helpers/get-display-media-support';
import {
  getScreenSharePreset,
  getScreenSharePresetSettings,
  ScreenSharePreset
} from '@/helpers/screen-share-presets';
import { getTRPCClient } from '@/lib/trpc';
import {
  NoiseSuppression,
  Resolution,
  ScreenCursor,
  VideoCodec,
  type TDeviceSettings
} from '@/types';
import { DEFAULT_BITRATE } from '@dodecagon/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Label,
  LoadingCard,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch
} from '@dodecagon/ui';
import {
  InformationCircleIcon,
  SpeakerWaveIcon
} from '@heroicons/react/24/outline';
import { filesize } from 'filesize';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMicrophoneTest } from './hooks/use-microphone-test';
import { useWebcamTest } from './hooks/use-webcam-test';
import { MicrophoneTestLevelBar } from './microphone-test-level-bar';
import { ResolutionFpsControl } from './resolution-fps-control';
import { RestrictOwnAudioAlert } from './restrict-own-audio-alert';
import { SuppressLocalAudioPlaybackAlert } from './suppress-local-audio-playback-alert';

const DEFAULT_NAME = 'default';

// Paper · Voice & video: the rows carry no separator of their own, the group
// label and the 17px group gap keep the sections apart
const DEVICE_ROW_CLASS = 'flex w-full items-center justify-between gap-4';
const DEVICE_GROUP_LABEL_CLASS =
  'text-[13px] font-bold uppercase leading-4 tracking-[0.08em] text-subtle-foreground';
// a preference is a plain value with a chevron, not a boxed field
const INLINE_SELECT_TRIGGER_CLASS =
  'h-auto w-auto border-0 bg-transparent px-0 py-1 text-sm text-muted-foreground hover:bg-transparent';
// picking a device keeps the recessed field of the design
const DEVICE_SELECT_TRIGGER_CLASS = 'w-full px-[15px]';
const DEVICE_FIELD_LABEL_CLASS = 'text-[13px] leading-4 text-foreground';

type TDeviceRowProps = {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
};

const DeviceRow = memo(({ label, description, children }: TDeviceRowProps) => {
  return (
    <div className={DEVICE_ROW_CLASS}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm leading-[18px] text-foreground">{label}</span>
        {description && (
          <span className="text-[13px] leading-4 text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
});

DeviceRow.displayName = 'DeviceRow';

const Devices = memo(() => {
  const { t } = useTranslation('settings');
  const currentVoiceChannelId = useCurrentVoiceChannelId();
  const settings = usePublicServerSettings();
  const ownVoiceState = useOwnVoiceState();
  const {
    devices,
    saveDevices,
    loading: devicesLoading,
    inputDevices,
    playbackDevices,
    videoDevices,
    loadDevices
  } = useDevices();
  const onSave = useCallback(
    async (values: TDeviceSettings) => {
      if (
        currentVoiceChannelId !== undefined &&
        values.voiceOnlyMode !== devices.voiceOnlyMode
      ) {
        const trpc = getTRPCClient();
        await trpc.voice.updateState.mutate({
          voiceOnlyMode: values.voiceOnlyMode
        });
      }

      return saveDevices(values);
    },
    [currentVoiceChannelId, devices.voiceOnlyMode, saveDevices]
  );
  const { values, onChange, reset } = useSettingsForm<TDeviceSettings>({
    initialValues: devices,
    onSave,
    successMessage: t('deviceSettingsSaved'),
    errorMessage: t('failedSaveDeviceSettings')
  });
  const noiseGateWorkletAvailability = useSyncExternalStore(
    subscribeNoiseGateWorkletAvailability,
    getNoiseGateWorkletAvailabilitySnapshot,
    getNoiseGateWorkletAvailabilitySnapshot
  );
  const isNoiseGateAvailable = noiseGateWorkletAvailability.available;
  const isRestrictOwnAudioSupported = useMemo(
    () => getRestrictOwnAudioSupport(),
    []
  );
  const isSuppressLocalAudioPlaybackSupported = useMemo(
    () => getSuppressLocalAudioPlaybackSupport(),
    []
  );

  const handleVoiceOnlyModeChange = useCallback(
    (enabled: boolean) => onChange('voiceOnlyMode', enabled),
    [onChange]
  );

  const handleDirectMediaSharingChange = useCallback(
    (enabled: boolean) => onChange('directScreenSharing', enabled),
    [onChange]
  );

  const handleScreenShareSimulcastChange = useCallback(
    (enabled: boolean) => onChange('screenShareSimulcastEnabled', enabled),
    [onChange]
  );

  const handlePlaybackChange = useCallback(
    (value: string) => {
      if (value) onChange('playbackId', value);
    },
    [onChange]
  );

  const handleMicrophoneChange = useCallback(
    (value: string) => {
      if (value) onChange('microphoneId', value);
    },
    [onChange]
  );

  const handleWebcamChange = useCallback(
    (value: string) => onChange('webcamId', value),
    [onChange]
  );

  const handleNoiseSuppressionChange = useCallback(
    (value: string) => onChange('noiseSuppression', value as NoiseSuppression),
    [onChange]
  );

  const handleEchoCancellationChange = useCallback(
    (checked: boolean) => onChange('echoCancellation', checked),
    [onChange]
  );

  const handleAutoGainControlChange = useCallback(
    (checked: boolean) => onChange('autoGainControl', checked),
    [onChange]
  );

  const handleNoiseGateChange = useCallback(
    (checked: boolean) => onChange('noiseGateEnabled', checked),
    [onChange]
  );

  const handleMirrorOwnVideoChange = useCallback(
    (checked: boolean) => onChange('mirrorOwnVideo', checked),
    [onChange]
  );

  const handleScreenCursorChange = useCallback(
    (value: string) => onChange('screenCursor', value as ScreenCursor),
    [onChange]
  );

  const handleSimulcastChange = useCallback(
    (checked: boolean) => onChange('simulcastEnabled', checked),
    [onChange]
  );

  const handleRestrictOwnAudioChange = useCallback(
    (checked: boolean) => onChange('restrictOwnAudio', checked),
    [onChange]
  );

  const handleSuppressLocalAudioPlaybackChange = useCallback(
    (checked: boolean) => onChange('suppressLocalAudioPlayback', checked),
    [onChange]
  );

  const handleWebcamFramerateChange = useCallback(
    (value: number) => onChange('webcamFramerate', value),
    [onChange]
  );

  const handleWebcamResolutionChange = useCallback(
    (value: string) => onChange('webcamResolution', value as Resolution),
    [onChange]
  );

  const handleScreenFramerateChange = useCallback(
    (value: number) => onChange('screenFramerate', value),
    [onChange]
  );

  const handleScreenResolutionChange = useCallback(
    (value: string) => onChange('screenResolution', value as Resolution),
    [onChange]
  );

  const handleScreenCodecChange = useCallback(
    (value: string) => onChange('screenCodec', value as VideoCodec),
    [onChange]
  );

  const handleScreenBitrateChange = useCallback(
    (value: number[]) => onChange('screenBitrate', value[0]),
    [onChange]
  );

  const handleNoiseGateThresholdChange = useCallback(
    (value: number) => onChange('noiseGateThresholdDb', value),
    [onChange]
  );

  const screenSharePreset = useMemo(
    () =>
      getScreenSharePreset({
        screenResolution: values.screenResolution,
        screenFramerate: values.screenFramerate,
        screenBitrate: values.screenBitrate
      }),
    [values.screenResolution, values.screenFramerate, values.screenBitrate]
  );

  const handleScreenSharePresetChange = useCallback(
    (value: string) => {
      const preset = value as ScreenSharePreset;
      const presetSettings = getScreenSharePresetSettings(preset);
      onChange('screenResolution', presetSettings.resolution);
      onChange('screenFramerate', presetSettings.framerate);
      onChange('screenCodec', presetSettings.codec);
      onChange('screenBitrate', presetSettings.bitrateKbps);
      onChange(
        'screenShareSimulcastEnabled',
        presetSettings.simulcast && !!settings?.webRtcSimulcastEnabled
      );
    },
    [onChange, settings?.webRtcSimulcastEnabled]
  );

  const {
    testAudioRef,
    permissionState,
    isTesting,
    getAudioLevelSnapshot,
    error: microphoneTestError,
    requestPermission,
    startTest,
    stopTest
  } = useMicrophoneTest({
    microphoneId: values.microphoneId,
    playbackId: values.playbackId,
    autoGainControl: !!values.autoGainControl,
    echoCancellation: !!values.echoCancellation,
    noiseSuppression: values.noiseSuppression,
    noiseGateEnabled: !!values.noiseGateEnabled,
    noiseGateThresholdDb:
      values.noiseGateThresholdDb ?? MICROPHONE_GATE_DEFAULT_THRESHOLD_DB
  });
  const {
    testVideoRef,
    isStarting: isVideoStarting,
    isTesting: isVideoTesting,
    isPreviewReady: isVideoPreviewReady,
    error: webcamTestError,
    startTest: startVideoTest,
    stopTest: stopVideoTest
  } = useWebcamTest({
    webcamId: values.webcamId,
    webcamResolution: values.webcamResolution,
    webcamFramerate: values.webcamFramerate
  });

  const mutedByTestRef = useRef<{
    previousMicMuted: boolean;
    previousSoundMuted: boolean;
  } | null>(null);
  const restoreVoiceStateAfterTestRef = useRef<() => Promise<void>>(
    async () => {}
  );

  const restoreVoiceStateAfterTest = useCallback(async () => {
    if (!currentVoiceChannelId) {
      mutedByTestRef.current = null;
      return;
    }

    const mutedByTest = mutedByTestRef.current;
    if (!mutedByTest) return;

    mutedByTestRef.current = null;

    const voiceControlsBridge = getVoiceControlsBridge();
    if (!voiceControlsBridge) {
      toast.error(t('voiceControlsUnavailable'));
      return;
    }

    await voiceControlsBridge.setMicMuted(mutedByTest.previousMicMuted);
    await voiceControlsBridge.setSoundMuted(mutedByTest.previousSoundMuted);
  }, [currentVoiceChannelId, t]);

  useEffect(() => {
    restoreVoiceStateAfterTestRef.current = restoreVoiceStateAfterTest;
  }, [restoreVoiceStateAfterTest]);

  const startMicrophoneTest = useCallback(async () => {
    if (currentVoiceChannelId) {
      const voiceControlsBridge = getVoiceControlsBridge();
      if (!voiceControlsBridge) {
        toast.error(t('voiceControlsUnavailable'));
        return;
      }

      mutedByTestRef.current = {
        previousMicMuted: ownVoiceState.micMuted,
        previousSoundMuted: ownVoiceState.soundMuted
      };

      await voiceControlsBridge.setMicMuted(true);
      await voiceControlsBridge.setSoundMuted(true);
    } else {
      mutedByTestRef.current = null;
    }

    const didStart = await startTest();

    if (!didStart) {
      await restoreVoiceStateAfterTest();
      return;
    }
  }, [
    currentVoiceChannelId,
    ownVoiceState.micMuted,
    ownVoiceState.soundMuted,
    startTest,
    restoreVoiceStateAfterTest,
    t
  ]);

  const stopMicrophoneTest = useCallback(async () => {
    stopTest();
    await restoreVoiceStateAfterTest();
  }, [stopTest, restoreVoiceStateAfterTest]);

  const requestMicrophonePermission = useCallback(async () => {
    await requestPermission();
    await loadDevices();
  }, [requestPermission, loadDevices]);

  const startWebcamTest = useCallback(async () => {
    const didStart = await startVideoTest();
    if (!didStart) return;

    await loadDevices();
  }, [startVideoTest, loadDevices]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    return () => {
      restoreVoiceStateAfterTestRef.current();
    };
  }, []);

  const hasMicrophones = inputDevices.length > 0;
  const hasDefaultPlaybackOption = playbackDevices.some(
    (device) => device?.deviceId === DEFAULT_NAME
  );
  const hasDefaultVideoOption = videoDevices.some(
    (device) => device?.deviceId === DEFAULT_NAME
  );

  const maxBitrate = useMemo(
    () => (settings?.webRtcMaxBitrate ? settings.webRtcMaxBitrate / 1000 : 0),
    [settings?.webRtcMaxBitrate]
  );

  useEffect(() => {
    reset(devices);
  }, [devices, reset]);

  if (devicesLoading) {
    return <LoadingCard className="h-[600px]" />;
  }

  return (
    <SettingsSection title={t('devicesTitle')} description={t('devicesDesc')}>
      {currentVoiceChannelId && (
        <Alert variant="default">
          <InformationCircleIcon />
          <AlertDescription>{t('voiceChannelActiveInfo')}</AlertDescription>
        </Alert>
      )}

      <div className="flex max-w-[1040px] flex-col gap-[26px]">
        <DeviceRow
          label={t('voiceOnlyModeLabel')}
          description={t('voiceOnlyModeDesc')}
        >
          <Switch
            aria-label={t('voiceOnlyModeLabel')}
            checked={!!values.voiceOnlyMode}
            onCheckedChange={handleVoiceOnlyModeChange}
          />
        </DeviceRow>

        <div className="flex flex-col gap-4 border-t border-line pt-[14px]">
          <div className={DEVICE_GROUP_LABEL_CLASS}>
            {t('audioDevicesLabel')}
          </div>

          <div className="flex flex-wrap gap-5">
            <label className="flex w-full max-w-[510px] basis-[510px] flex-col gap-2">
              <span className={DEVICE_FIELD_LABEL_CLASS}>
                {t('playbackLabel')}
              </span>
              <Select
                onValueChange={handlePlaybackChange}
                value={values.playbackId}
                disabled={playbackDevices.length === 0}
              >
                <SelectTrigger className={DEVICE_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t('playbackPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {!hasDefaultPlaybackOption && (
                      <SelectItem value={DEFAULT_NAME}>
                        {t('defaultOutput')}
                      </SelectItem>
                    )}
                    {playbackDevices.map((device) => (
                      <SelectItem
                        key={device?.deviceId}
                        value={device?.deviceId || DEFAULT_NAME}
                      >
                        {device?.label.trim() || t('defaultOutput')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>

            <label className="flex w-full max-w-[510px] basis-[510px] flex-col gap-2">
              <span className={DEVICE_FIELD_LABEL_CLASS}>
                {t('microphoneLabel')}
              </span>
              <Select
                onValueChange={handleMicrophoneChange}
                value={values.microphoneId}
                disabled={inputDevices.length === 0}
              >
                <SelectTrigger className={DEVICE_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder={t('microphonePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {inputDevices.map((device) => (
                      <SelectItem
                        key={device?.deviceId}
                        value={device?.deviceId || DEFAULT_NAME}
                      >
                        {device?.label.trim() || t('defaultMicrophone')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-[17px] border-t border-line pt-[14px]">
          <div className={DEVICE_GROUP_LABEL_CLASS}>{t('microphoneLabel')}</div>

          <DeviceRow label={t('noiseSuppressionLabel')}>
            <Select
              value={values.noiseSuppression}
              onValueChange={handleNoiseSuppressionChange}
            >
              <SelectTrigger className={INLINE_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NoiseSuppression.NONE}>
                    {t('noiseSuppressionNone')}
                  </SelectItem>
                  <SelectItem value={NoiseSuppression.STANDARD}>
                    {t('standard')}
                  </SelectItem>
                  <SelectItem value={NoiseSuppression.RNNOISE}>
                    RNNoise ({t('experimental')})
                  </SelectItem>
                  <SelectItem value={NoiseSuppression.DTLN}>
                    DTLN ({t('experimental')})
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </DeviceRow>

          <DeviceRow label={t('echoCancellationLabel')}>
            <Switch
              aria-label={t('echoCancellationLabel')}
              checked={!!values.echoCancellation}
              onCheckedChange={handleEchoCancellationChange}
            />
          </DeviceRow>

          <DeviceRow label={t('autoGainControlLabel')}>
            <Switch
              aria-label={t('autoGainControlLabel')}
              checked={!!values.autoGainControl}
              onCheckedChange={handleAutoGainControlChange}
            />
          </DeviceRow>

          <DeviceRow
            label={t('noiseGateLabel')}
            description={
              isNoiseGateAvailable
                ? undefined
                : `${t('noiseGateUnavailable')}${
                    noiseGateWorkletAvailability.reason
                      ? ` ${noiseGateWorkletAvailability.reason}`
                      : ''
                  }`
            }
          >
            <Switch
              aria-label={t('noiseGateLabel')}
              checked={values.noiseGateEnabled}
              disabled={!isNoiseGateAvailable}
              onCheckedChange={handleNoiseGateChange}
            />
          </DeviceRow>

          <div className="flex flex-col gap-3 rounded-[8px] bg-panel p-[15px]">
            <div className="flex flex-wrap items-center gap-[15px]">
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[7px] bg-raised">
                <SpeakerWaveIcon className="size-[22px] text-foreground" />
              </div>
              <span className="text-sm leading-[18px] text-foreground">
                {t('microphoneTestLabel')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {permissionState !== 'granted' && (
                  <Button
                    variant="outline"
                    onClick={requestMicrophonePermission}
                  >
                    {t('permitMicAccess')}
                  </Button>
                )}

                {!isTesting ? (
                  <Button
                    variant="secondary"
                    onClick={() => void startMicrophoneTest()}
                    disabled={permissionState === 'denied' || !hasMicrophones}
                  >
                    {t('startTestBtn')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => void stopMicrophoneTest()}
                  >
                    {t('stopTestBtn')}
                  </Button>
                )}
              </div>
            </div>

            {currentVoiceChannelId && isTesting && (
              <p className="text-[13px] leading-4 text-muted-foreground">
                {t('mutedDuringTest')}
              </p>
            )}

            <MicrophoneTestLevelBar
              isTesting={isTesting}
              noiseGateEnabled={values.noiseGateEnabled}
              noiseGateControlsDisabled={!isNoiseGateAvailable}
              noiseGateThresholdDb={values.noiseGateThresholdDb}
              onThresholdChange={handleNoiseGateThresholdChange}
              getAudioLevelSnapshot={getAudioLevelSnapshot}
            />

            {microphoneTestError && (
              <Alert variant="destructive">
                <InformationCircleIcon />
                <AlertDescription>{microphoneTestError}</AlertDescription>
              </Alert>
            )}

            <audio ref={testAudioRef} className="hidden" />
          </div>
        </div>

        <div className="flex flex-col gap-[17px] border-t border-line pt-[14px]">
          <div className={DEVICE_GROUP_LABEL_CLASS}>{t('cameraLabel')}</div>

          <DeviceRow label={t('webcamLabel')}>
            <Select onValueChange={handleWebcamChange} value={values.webcamId}>
              <SelectTrigger className={INLINE_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t('webcamPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {!hasDefaultVideoOption && (
                    <SelectItem value={DEFAULT_NAME}>
                      {t('defaultWebcam')}
                    </SelectItem>
                  )}
                  {videoDevices.map((device) => (
                    <SelectItem
                      key={device?.deviceId}
                      value={device?.deviceId || DEFAULT_NAME}
                    >
                      {device?.label.trim() || t('defaultWebcam')}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </DeviceRow>

          <DeviceRow label={t('mirrorOwnVideoLabel')}>
            <Switch
              aria-label={t('mirrorOwnVideoLabel')}
              checked={!!values.mirrorOwnVideo}
              onCheckedChange={handleMirrorOwnVideoChange}
            />
          </DeviceRow>

          <div className="group relative h-[140px] w-full overflow-hidden rounded-[8px] bg-panel">
            <video
              ref={testVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full object-cover transition-opacity duration-150 ${
                values.mirrorOwnVideo ? '-scale-x-100' : ''
              } ${isVideoTesting ? 'opacity-100' : 'opacity-0'}`}
            />

            {!isVideoTesting && !isVideoStarting && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Button
                  variant="secondary"
                  onClick={() => void startWebcamTest()}
                >
                  {t('startVideoPreviewBtn')}
                </Button>
              </div>
            )}

            {(isVideoStarting || (isVideoTesting && !isVideoPreviewReady)) && (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] leading-4 text-muted-foreground">
                {t('startingCamera')}
              </div>
            )}

            {isVideoTesting && (
              <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-3 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button
                  variant="secondary"
                  className="pointer-events-auto"
                  onClick={stopVideoTest}
                >
                  {t('stopVideoPreviewBtn')}
                </Button>
              </div>
            )}
          </div>

          {webcamTestError && (
            <Alert variant="destructive">
              <InformationCircleIcon />
              <AlertDescription>{webcamTestError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t('webcamLabel')}</Label>
            <ResolutionFpsControl
              framerate={values.webcamFramerate}
              resolution={values.webcamResolution}
              onFramerateChange={handleWebcamFramerateChange}
              onResolutionChange={handleWebcamResolutionChange}
            />
          </div>
        </div>

        <div className="flex flex-col gap-[17px] border-t border-line pt-[14px]">
          <div className={DEVICE_GROUP_LABEL_CLASS}>
            {t('screenSharingLabel')}
          </div>

          <DeviceRow
            label={t('screenSharePresetLabel')}
            description={t('screenSharePresetDesc')}
          >
            <Select
              value={screenSharePreset ?? ''}
              onValueChange={handleScreenSharePresetChange}
            >
              <SelectTrigger className={INLINE_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder={t('screenSharePresetCustom')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ScreenSharePreset.MOTION}>
                    {t('screenSharePresetMotion')}
                  </SelectItem>
                  <SelectItem value={ScreenSharePreset.TEXT}>
                    {t('screenSharePresetText')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </DeviceRow>

          <DeviceRow label={t('screenCursorLabel')}>
            <Select
              value={values.screenCursor ?? ScreenCursor.ALWAYS}
              onValueChange={handleScreenCursorChange}
            >
              <SelectTrigger className={INLINE_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ScreenCursor.ALWAYS}>
                    {t('screenCursorAlways')}
                  </SelectItem>
                  <SelectItem value={ScreenCursor.MOTION}>
                    {t('screenCursorMotion')}
                  </SelectItem>
                  <SelectItem value={ScreenCursor.NEVER}>
                    {t('screenCursorNever')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </DeviceRow>

          <DeviceRow
            label={t('simulcastUserLabel')}
            description={
              settings?.webRtcSimulcastEnabled
                ? t('simulcastUserDesc')
                : t('simulcastDisabledByServerDesc')
            }
          >
            <Switch
              aria-label={t('simulcastUserLabel')}
              checked={!!values.simulcastEnabled}
              disabled={!settings?.webRtcSimulcastEnabled}
              onCheckedChange={handleSimulcastChange}
            />
          </DeviceRow>

          <DeviceRow
            label={t('directScreenSharingLabel')}
            description={t('directScreenSharingDesc')}
          >
            <Switch
              aria-label={t('directScreenSharingLabel')}
              checked={!!values.directScreenSharing}
              disabled={
                currentVoiceChannelId !== undefined ||
                typeof RTCPeerConnection === 'undefined'
              }
              onCheckedChange={handleDirectMediaSharingChange}
            />
          </DeviceRow>

          <DeviceRow
            label={t('screenShareSimulcastLabel')}
            description={
              settings?.webRtcSimulcastEnabled
                ? t('screenShareSimulcastDesc')
                : t('simulcastDisabledByServerDesc')
            }
          >
            <Switch
              aria-label={t('screenShareSimulcastLabel')}
              checked={!!values.screenShareSimulcastEnabled}
              disabled={!settings?.webRtcSimulcastEnabled}
              onCheckedChange={handleScreenShareSimulcastChange}
            />
          </DeviceRow>

          <div className="flex flex-col gap-2">
            <Label>{t('screenSharingLabel')}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <ResolutionFpsControl
                framerate={values.screenFramerate}
                resolution={values.screenResolution}
                onFramerateChange={handleScreenFramerateChange}
                onResolutionChange={handleScreenResolutionChange}
              />

              <Select
                value={values.screenCodec ?? VideoCodec.AUTO}
                onValueChange={handleScreenCodecChange}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('selectCodecPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={VideoCodec.AUTO}>Auto</SelectItem>
                    <SelectItem value={VideoCodec.VP8}>VP8</SelectItem>
                    <SelectItem value={VideoCodec.VP9}>VP9</SelectItem>
                    <SelectItem value={VideoCodec.H264}>H264</SelectItem>
                    <SelectItem value={VideoCodec.AV1}>AV1</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('maxBitrateLabel')}</Label>

            <Slider
              className="max-w-96"
              min={200}
              max={maxBitrate}
              step={100}
              value={[values.screenBitrate ?? DEFAULT_BITRATE]}
              onValueChange={handleScreenBitrateChange}
              rightSlot={
                <span className="w-20 text-right text-sm text-muted-foreground">
                  {filesize((values.screenBitrate ?? DEFAULT_BITRATE) * 125, {
                    bits: true
                  })}
                  /s
                </span>
              }
            />
          </div>

          <DeviceRow
            label={t('restrictOwnAudioLabel')}
            description={t('restrictOwnAudioDesc')}
          >
            {isRestrictOwnAudioSupported ? (
              <Switch
                aria-label={t('restrictOwnAudioLabel')}
                checked={!!values.restrictOwnAudio}
                disabled={!isRestrictOwnAudioSupported}
                onCheckedChange={handleRestrictOwnAudioChange}
              />
            ) : (
              <RestrictOwnAudioAlert
                isSupported={isRestrictOwnAudioSupported}
              />
            )}
          </DeviceRow>

          <DeviceRow
            label={t('suppressLocalAudioPlaybackLabel')}
            description={t('suppressLocalAudioPlaybackDesc')}
          >
            {isSuppressLocalAudioPlaybackSupported ? (
              <Switch
                aria-label={t('suppressLocalAudioPlaybackLabel')}
                checked={!!values.suppressLocalAudioPlayback}
                disabled={!isSuppressLocalAudioPlaybackSupported}
                onCheckedChange={handleSuppressLocalAudioPlaybackChange}
              />
            ) : (
              <SuppressLocalAudioPlaybackAlert
                isSupported={isSuppressLocalAudioPlaybackSupported}
              />
            )}
          </DeviceRow>

          <span className="text-[13px] leading-4 text-muted-foreground">
            {t('screenSharingNote')}
          </span>
        </div>
      </div>
    </SettingsSection>
  );
});

export { Devices };
