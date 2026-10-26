// Renders the server settings button and prints the markup. The test runs this in
// its own process: bun keeps the first mock.module registration of a path for the
// whole test run, so the mocks of the other test files would leak in.
import sidebarEn from '@/i18n/locales/en/sidebar.json';
import * as RealUI from '@dodecagon/ui';
import { mock } from 'bun:test';
import i18next from 'i18next';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

const noop = () => {};

globalThis.window =
  globalThis.window ??
  ({
    addEventListener: noop,
    removeEventListener: noop,
    clearTimeout: noop,
    setTimeout: noop,
    location: { href: 'http://localhost' }
  } as unknown as Window & typeof globalThis);

globalThis.document =
  globalThis.document ??
  ({
    addEventListener: noop,
    removeEventListener: noop,
    head: { appendChild: noop },
    body: { appendChild: noop },
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }),
    getElementById: () => null,
    getElementsByTagName: () => [{ appendChild: noop }]
  } as unknown as Document);

// a reader has none of the server permissions, so the button must stay away
const mode = process.argv[2] ?? 'default';

const realUi = { ...RealUI };

// keep a handle on the real button before the module is mocked, the spy below
// still has to render the production markup
const RealIconButton = RealUI.IconButton;

const records: {
  buttons: ComponentProps<typeof RealUI.IconButton>[];
  screens: string[];
} = {
  buttons: [],
  screens: []
};

const SpyIconButton = (props: ComponentProps<typeof RealUI.IconButton>) => {
  records.buttons.push(props);

  return <RealIconButton {...props} />;
};

mock.module('@dodecagon/ui', () => ({
  ...realUi,
  IconButton: SpyIconButton
}));

mock.module('@/features/server/hooks', () => ({
  useCan: () => () => mode !== 'reader'
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: (overlay: { name: string }) => {
    records.screens.push(overlay.name);
  }
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { sidebar: sidebarEn } },
  interpolation: { escapeValue: false }
});

const { ServerSettingsButton } = await import('../server-settings-button');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <ServerSettingsButton />
  </I18nextProvider>
);

records.buttons[0]?.onClick?.({} as never);

console.log(`__RESULT__${JSON.stringify({ html, screens: records.screens })}`);
