import { MICROPHONE_GATE_DEFAULT_THRESHOLD_DB } from '@/helpers/audio-gate';
import { logVoice, logVoiceError } from '@/helpers/browser-logger';
import { getRestrictOwnAudioSupport } from '@/helpers/get-display-media-support';
import {
  getLocalStorageItemAsJSON,
  LocalStorageKey,
  setLocalStorageItemAsJSON
} from '@/helpers/storage';
import {
  NoiseSuppression,
  Resolution,
  ScreenCursor,
  VideoCodec,
  type TDeviceSettings
} from '@/types';
import { DEFAULT_BITRATE } from '@dodecagon/shared';
import {
  createContext,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const getDefaultDeviceSettings = (): TDeviceSettings => ({
  microphoneVolume: 100,
  playbackVolume: 100,
  microphoneId: undefined,
  playbackId: undefined,
  webcamId: undefined,
  webcamResolution: Resolution['720p'],
  webcamFramerate: 30,
  echoCancellation: true,
  noiseSuppression: NoiseSuppression.RNNOISE,
  autoGainControl: true,
  noiseGateEnabled: false,
  noiseGateThresholdDb: MICROPHONE_GATE_DEFAULT_THRESHOLD_DB,
  shareSystemAudio: true,
  restrictOwnAudio: getRestrictOwnAudioSupport(),
  suppressLocalAudioPlayback: false,
  mirrorOwnVideo: false,
  simulcastEnabled: true,
  screenShareSimulcastEnabled: false,
  directScreenSharing: true,
  voiceOnlyMode: false,
  screenResolution: Resolution['720p'],
  screenFramerate: 30,
  screenCodec: VideoCodec.AUTO,
  screenBitrate: DEFAULT_BITRATE,
  screenCursor: ScreenCursor.ALWAYS
});

const getInitialDeviceSettings = (): TDeviceSettings => {
  const defaultDeviceSettings = getDefaultDeviceSettings();
  const savedSettings = getLocalStorageItemAsJSON<TDeviceSettings>(
    LocalStorageKey.DEVICES_SETTINGS
  );

  if (!savedSettings) return defaultDeviceSettings;

  const noiseSuppressionValues = Object.values(NoiseSuppression) as string[];
  const rawNs = savedSettings.noiseSuppression as unknown;
  let noiseSuppression: NoiseSuppression;

  if (noiseSuppressionValues.includes(rawNs as string)) {
    noiseSuppression = rawNs as NoiseSuppression;
  } else if (rawNs === true) {
    noiseSuppression = NoiseSuppression.STANDARD;
  } else {
    noiseSuppression = NoiseSuppression.NONE;
  }

  const restrictOwnAudio = defaultDeviceSettings.restrictOwnAudio
    ? (savedSettings.restrictOwnAudio ?? true)
    : false;

  // one-time migration: legacy simulcast applied to both webcam and screen-share.
  // new installs keep the independent screen-share default of false.
  const screenShareSimulcastEnabled =
    savedSettings.screenShareSimulcastEnabled ??
    savedSettings.simulcastEnabled ??
    defaultDeviceSettings.screenShareSimulcastEnabled;

  return {
    ...defaultDeviceSettings,
    ...savedSettings,
    noiseSuppression,
    restrictOwnAudio,
    screenShareSimulcastEnabled
  };
};

const resolveDeviceId = (
  savedId: string | undefined,
  availableDevices: (MediaDeviceInfo | undefined)[]
): string => {
  // Anonymous/empty discovery before permission cannot invalidate a saved ID.
  if (
    savedId &&
    (availableDevices.some((device) => device?.deviceId === savedId) ||
      availableDevices.every((device) => !device?.label.trim()))
  ) {
    return savedId;
  }

  const defaultDevice = availableDevices.find((d) => d?.deviceId === 'default');

  if (defaultDevice) return defaultDevice.deviceId;

  return availableDevices[0]?.deviceId ?? 'default';
};

const normalizeDevices = (devices: MediaDeviceInfo[]) => {
  const seen = new Set<string>();
  const normalized: MediaDeviceInfo[] = [];

  for (const device of devices) {
    if (!device.deviceId) {
      continue;
    }

    const dedupeKey = device.deviceId;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push(device);
  }

  normalized.sort((a, b) => {
    if (a.deviceId === 'default') return -1;
    if (b.deviceId === 'default') return 1;

    return a.label.localeCompare(b.label);
  });

  return normalized;
};

export type TDevicesProvider = {
  loading: boolean;
  devices: TDeviceSettings;
  inputDevices: (MediaDeviceInfo | undefined)[];
  playbackDevices: (MediaDeviceInfo | undefined)[];
  videoDevices: (MediaDeviceInfo | undefined)[];
  saveDevices: (
    newDevices:
      TDeviceSettings | ((current: TDeviceSettings) => TDeviceSettings)
  ) => void;
  loadDevices: () => Promise<void>;
};

const DevicesProviderContext = createContext<TDevicesProvider | undefined>(
  undefined
);

type TDevicesProviderProps = {
  children: React.ReactNode;
};

const DevicesProvider = memo(({ children }: TDevicesProviderProps) => {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<TDeviceSettings>(
    getInitialDeviceSettings
  );
  const [inputDevices, setInputDevices] = useState<
    (MediaDeviceInfo | undefined)[]
  >([]);
  const [playbackDevices, setPlaybackDevices] = useState<
    (MediaDeviceInfo | undefined)[]
  >([]);
  const [videoDevices, setVideoDevices] = useState<
    (MediaDeviceInfo | undefined)[]
  >([]);
  const [devicesEnumerated, setDevicesEnumerated] = useState(false);
  const initializedRef = useRef(false);
  const devicesRef = useRef(devices);

  // written in an effect rather than during render: a render that is never committed would
  // otherwise leave the ref holding a value no one else can see. only read from callbacks,
  // which always run after commit
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  const { t } = useTranslation();

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevicesEnumerated(true);

      return;
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();

      logVoice('devices: enumerated', {
        audioInputs: allDevices.filter((d) => d.kind === 'audioinput').length,
        audioOutputs: allDevices.filter((d) => d.kind === 'audiooutput').length,
        videoInputs: allDevices.filter((d) => d.kind === 'videoinput').length
      });

      setInputDevices(
        normalizeDevices(allDevices.filter((d) => d.kind === 'audioinput'))
      );

      setPlaybackDevices(
        normalizeDevices(allDevices.filter((d) => d.kind === 'audiooutput'))
      );

      setVideoDevices(
        normalizeDevices(allDevices.filter((d) => d.kind === 'videoinput'))
      );
    } catch (error) {
      toast.error(t('failedLoadDevices'));
      logVoiceError('devices: enumeration failed', error);
    } finally {
      setDevicesEnumerated(true);
    }
  }, [t]);

  useEffect(() => {
    loadDevices();

    if (!navigator.mediaDevices?.addEventListener) return;

    const onDeviceChange = () => {
      logVoice('devices: device list changed');
      loadDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        onDeviceChange
      );
    };
  }, [loadDevices]);

  const saveDevices = useCallback(
    (
      newDevices:
        TDeviceSettings | ((current: TDeviceSettings) => TDeviceSettings)
    ) => {
      const updatedDevices =
        typeof newDevices === 'function'
          ? newDevices(devicesRef.current)
          : newDevices;
      devicesRef.current = updatedDevices;
      setDevices(updatedDevices);
      setLocalStorageItemAsJSON<TDeviceSettings>(
        LocalStorageKey.DEVICES_SETTINGS,
        updatedDevices
      );
    },
    []
  );

  useEffect(() => {
    if (!devicesEnumerated) return;

    const isInitialEnumeration = !initializedRef.current;

    if (isInitialEnumeration) {
      initializedRef.current = true;

      setLoading(false);
    }

    const prev = devicesRef.current;
    const microphoneId = resolveDeviceId(prev.microphoneId, inputDevices);
    const playbackId = resolveDeviceId(prev.playbackId, playbackDevices);
    const webcamId = resolveDeviceId(prev.webcamId, videoDevices);

    if (
      !isInitialEnumeration &&
      microphoneId === prev.microphoneId &&
      playbackId === prev.playbackId &&
      webcamId === prev.webcamId
    ) {
      return;
    }

    const updated = { ...prev, microphoneId, playbackId, webcamId };

    setDevices(updated);
    setLocalStorageItemAsJSON(LocalStorageKey.DEVICES_SETTINGS, updated);
  }, [devicesEnumerated, inputDevices, playbackDevices, videoDevices]);

  const contextValue = useMemo<TDevicesProvider>(
    () => ({
      loading,
      devices,
      inputDevices,
      playbackDevices,
      videoDevices,
      saveDevices,
      loadDevices
    }),
    [
      loading,
      devices,
      inputDevices,
      playbackDevices,
      videoDevices,
      saveDevices,
      loadDevices
    ]
  );

  return (
    <DevicesProviderContext.Provider value={contextValue}>
      {children}
    </DevicesProviderContext.Provider>
  );
});

export { DevicesProvider, DevicesProviderContext };
