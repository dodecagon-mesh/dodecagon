// Renders the cache settings and prints the markup. The test runs this in its
// own process: bun keeps the first mock.module registration of a path for the
// whole test run, so the mocks of the other test files would leak in.
import settingsEn from '@/i18n/locales/en/settings.json';
import { renderInDom } from '@/test-utils/dom-render';
import { mock } from 'bun:test';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';

const noop = () => {};

mock.module('@/helpers/media-cache', () => ({
  MEDIA_CACHE_NAME: 'dodecagon-media-v1',
  MEDIA_CACHE_PREFIX: 'dodecagon-media-',
  isMediaCacheSupported: () => true,
  registerMediaCacheWorker: noop,
  getMediaCacheStats: async () => ({ entries: 3, bytes: 5 * 1024 * 1024 }),
  clearMediaCache: async () => {}
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { settings: settingsEn } },
  interpolation: { escapeValue: false }
});

const { Cache } = await import('../index');

const html = await renderInDom(
  <I18nextProvider i18n={i18n}>
    <Cache />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
