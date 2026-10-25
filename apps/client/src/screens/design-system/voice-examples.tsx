import { CardTheme } from '@/components/channel-view/voice/card-theme';
import { VoiceCardContextMenu } from '@/components/channel-view/voice/voice-card-context-menu';
import { VoiceGrid } from '@/components/channel-view/voice/voice-grid';
import {
  VolumeControlContext,
  type TVolumeControlContext
} from '@/components/voice-provider/volume-control-context';
import { Slider } from '@dodecagon/ui';
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react';
import { useTranslation } from 'react-i18next';
import { Example, Section } from './section';

const DEMO_KEY = 'design-system-example';
const getUserVolumeKey = (id: number) => `user-${id}`;
const getUserScreenVolumeKey = (id: number) => `userscreen-${id}`;
const getExternalVolumeKey = (plugin: string, key: string) =>
  `external-${plugin}-${key}`;

const VoiceExampleCard = memo(({ name }: { name: string }) => {
  const { t } = useTranslation('design-system');
  const openMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(
      new globalThis.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.x + bounds.width / 2,
        clientY: bounds.y + bounds.height / 2
      })
    );
  }, []);

  return (
    <VoiceCardContextMenu volumeKey={DEMO_KEY}>
      <button
        type="button"
        onClick={openMenu}
        aria-label={t('openVoiceMenu', { name })}
        className="relative flex size-full min-h-24 min-w-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-line p-4 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <CardTheme profileColor="var(--panel)" />
        <span
          className="relative flex size-10 items-center justify-center rounded-full bg-raised text-base font-semibold"
          aria-hidden="true"
        >
          {name.slice(0, 1)}
        </span>
        <span className="relative text-sm font-medium">{name}</span>
        <span className="relative text-xs text-muted-foreground">
          {t('openMenu')}
        </span>
      </button>
    </VoiceCardContextMenu>
  );
});

export const VoiceExamples = memo(() => {
  const { t } = useTranslation('design-system');
  const [volume, setDemoVolume] = useState(65);
  const previousVolume = useRef(65);
  const getVolume = useCallback(() => volume, [volume]);
  const setVolume = useCallback((_key: string, value: number) => {
    if (value > 0) previousVolume.current = value;
    setDemoVolume(value);
  }, []);
  const toggleMute = useCallback(() => {
    setDemoVolume((value) => (value === 0 ? previousVolume.current : 0));
  }, []);
  const changeVolume = useCallback(
    ([value]: number[]) => {
      if (value !== undefined) setVolume(DEMO_KEY, value);
    },
    [setVolume]
  );
  const context = useMemo<TVolumeControlContext>(
    () => ({
      volumes: { [DEMO_KEY]: volume },
      getVolume,
      setVolume,
      toggleMute,
      getUserVolumeKey,
      getUserScreenVolumeKey,
      getExternalVolumeKey
    }),
    [volume, getVolume, setVolume, toggleMute]
  );
  const cards = useMemo(
    () => [
      <VoiceExampleCard key="studio" name={t('studio')} />,
      <VoiceExampleCard key="lounge" name={t('lounge')} />
    ],
    [t]
  );

  return (
    <Section id="voice" number="06">
      <p className="mb-6 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        {t('voiceNote')}
      </p>
      <VolumeControlContext.Provider value={context}>
        <Example title="VoiceGrid · CardTheme · VoiceCardContextMenu">
          <div className="h-96 min-w-0 overflow-hidden rounded-lg border border-line">
            <VoiceGrid className="gap-3 p-4">{cards}</VoiceGrid>
          </div>
          <div className="mt-6 max-w-sm space-y-3">
            <div className="flex justify-between gap-3 text-sm">
              <span id="voice-example-volume">{t('volumeExample')}</span>
              <output className="tabular-nums">{volume}%</output>
            </div>
            <Slider
              aria-labelledby="voice-example-volume"
              value={[volume]}
              onValueChange={changeVolume}
              min={0}
              max={100}
              step={1}
            />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {t('voiceHelp')}
          </p>
        </Example>
      </VolumeControlContext.Provider>
    </Section>
  );
});
