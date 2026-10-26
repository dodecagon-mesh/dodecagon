// Renders the left sidebar and prints the markup. The test runs this in its own
// process: bun keeps the first mock.module registration of a path for the whole
// test run, so the mocks of the other test files would leak in.
import topbarEn from '@/i18n/locales/en/topbar.json';
import { mock } from 'bun:test';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

const noop = () => {};

globalThis.window =
  globalThis.window ??
  ({
    addEventListener: noop,
    removeEventListener: noop,
    location: { href: 'http://localhost', search: '' },
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  } as unknown as Window & typeof globalThis);

globalThis.document =
  globalThis.document ??
  ({
    addEventListener: noop,
    removeEventListener: noop,
    head: { appendChild: noop },
    body: { appendChild: noop, style: {} },
    documentElement: { clientWidth: 1024, clientHeight: 768, style: {} },
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    createTextNode: () => ({}),
    getElementById: () => null,
    getElementsByTagName: () => [{ appendChild: noop }]
  } as unknown as Document);

mock.module('@/features/server/hooks', () => ({
  useServerName: () => 'ULTRABUSTER',
  usePublicServerSettings: () => ({ enableSearch: true }),
  useCan: () => () => true
}));

mock.module('@/features/overlays/actions', () => ({ openOverlay: noop }));

mock.module('@/features/server/channels/actions', () => ({
  setSelectedChannelId: noop
}));

mock.module('@/components/plugin-slot-renderer', () => ({
  PluginSlotRenderer: () => null
}));

mock.module('@/components/left-sidebar/categories', () => ({
  Categories: () => null
}));

mock.module('@/components/left-sidebar/direct-messages', () => ({
  DirectMessages: () => null
}));

mock.module('@/components/left-sidebar/direct-messages/dm-button', () => ({
  DmButton: () => null
}));

mock.module('@/components/left-sidebar/hooks', () => ({
  useFollowVoiceMove: noop,
  useRestoreLastSelectedChannel: noop
}));

mock.module('@/components/left-sidebar/plugin-buttons', () => ({
  PluginButtons: () => null
}));

mock.module('@/components/left-sidebar/server-dropdown', () => ({
  ServerDropdownMenu: () => null
}));

mock.module('@/components/left-sidebar/user-control', () => ({
  UserControl: () => null
}));

mock.module('@/components/left-sidebar/voice-control', () => ({
  VoiceControl: () => null
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { topbar: topbarEn } },
  interpolation: { escapeValue: false }
});

const { LeftSidebar } = await import('../index');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <LeftSidebar />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
