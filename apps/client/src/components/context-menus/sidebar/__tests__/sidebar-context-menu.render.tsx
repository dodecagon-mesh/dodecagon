// Renders the sidebar context menu and prints the markup. The test runs this in
// its own process: bun keeps the first mock.module registration of a path for the
// whole test run, so the mocks of the other test files would leak in.
import sidebarEn from '@/i18n/locales/en/sidebar.json';
import * as RealUI from '@dodecagon/ui';
import { mock } from 'bun:test';
import i18next from 'i18next';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';

const noop = () => {};

globalThis.window =
  globalThis.window ??
  ({
    addEventListener: noop,
    removeEventListener: noop,
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

// a user without the category permission gets no menu at all
const mode = process.argv[2] ?? 'default';

const realUi = { ...RealUI };

const records: {
  items: ComponentProps<typeof RealUI.ContextMenuItem>[];
  dialogs: string[];
} = {
  items: [],
  dialogs: []
};

// the real menu renders through a portal and needs a menu context, so the shell
// is swapped for plain elements that keep the item props
const PlainContextMenu = ({ children }: { children?: ReactNode }) => (
  <>{children}</>
);

const PlainContextMenuTrigger = ({ children }: { children?: ReactNode }) => (
  <>{children}</>
);

const PlainContextMenuContent = ({ children }: { children?: ReactNode }) => (
  <div>{children}</div>
);

const PlainContextMenuItem = (
  props: ComponentProps<typeof RealUI.ContextMenuItem>
) => {
  records.items.push(props);

  return (
    <div role="menuitem" onClick={props.onClick}>
      {props.children}
    </div>
  );
};

mock.module('@dodecagon/ui', () => ({
  ...realUi,
  ContextMenu: PlainContextMenu,
  ContextMenuTrigger: PlainContextMenuTrigger,
  ContextMenuContent: PlainContextMenuContent,
  ContextMenuItem: PlainContextMenuItem
}));

mock.module('@/features/server/hooks', () => ({
  useCan: () => () => mode !== 'reader'
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: (overlay: { name: string }) => {
    records.dialogs.push(overlay.name);
  }
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { sidebar: sidebarEn } },
  interpolation: { escapeValue: false }
});

const { SidebarContextMenu } = await import('../index');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <SidebarContextMenu>
      <div>sidebar</div>
    </SidebarContextMenu>
  </I18nextProvider>
);

records.items[0]?.onClick?.({} as never);

console.log(`__RESULT__${JSON.stringify({ html, dialogs: records.dialogs })}`);
