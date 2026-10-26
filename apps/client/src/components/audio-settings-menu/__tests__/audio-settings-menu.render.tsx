// Renders the audio device popup and prints the markup. The test runs this in
// its own process: bun keeps the first mock.module registration of a path for
// the whole test run, so the mocks of the other test files would leak in.
import audioEn from '@/i18n/locales/en/audio.json';
import settingsEn from '@/i18n/locales/en/settings.json';
import { renderInDom } from '@/test-utils/dom-render';
import { mock } from 'bun:test';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';

const noop = () => {};

mock.module('@/features/overlays/actions', () => ({
  openOverlay: noop
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { audio: audioEn, settings: settingsEn } },
  interpolation: { escapeValue: false }
});

const { DevicesProviderContext } =
  await import('@/components/devices-provider');
const { AudioSettingsMenu } = await import('../index');

const kind = process.argv[2] === 'output' ? 'output' : 'microphone';

const devicesContext = {
  loading: false,
  devices: {
    microphoneId: 'mic',
    playbackId: 'out',
    microphoneVolume: 75,
    playbackVolume: 60
  },
  inputDevices: [{ deviceId: 'mic', label: 'Studio microphone' }],
  playbackDevices: [{ deviceId: 'out', label: 'Headphones' }],
  videoDevices: [],
  saveDevices: noop,
  loadDevices: async () => {}
};

// the popup opens from the context menu of its anchor, so the event is
// dispatched on the mounted anchor to open it before the markup is read
const openThePopup = () => {
  const anchor = document.querySelector('span[data-slot="popover-anchor"]');

  anchor?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
};

const html = await renderInDom(
  <I18nextProvider i18n={i18n}>
    <DevicesProviderContext.Provider value={devicesContext as never}>
      <AudioSettingsMenu kind={kind}>
        <button type="button">trigger</button>
      </AudioSettingsMenu>
    </DevicesProviderContext.Provider>
  </I18nextProvider>,
  openThePopup
);

console.log(`__MARKUP__${html}`);
