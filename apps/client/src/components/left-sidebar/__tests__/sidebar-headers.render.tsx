// Renders the direct channels and the category headers and prints their markup.
// The test runs this in its own process: bun keeps the first mock.module
// registration of a path for the whole test run, so the mocks of the other
// test files would leak in.
import sidebarEn from '@/i18n/locales/en/sidebar.json';
import { mock } from 'bun:test';
import i18next from 'i18next';
import type { ReactNode } from 'react';
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
    createTextNode: () => ({}),
    getElementById: () => null,
    getElementsByTagName: () => [{ appendChild: noop }]
  } as unknown as Document);

const category = {
  id: 7,
  name: 'Text channels',
  position: 1,
  createdAt: 0,
  updatedAt: null
};

mock.module('@/features/server/categories/hooks', () => ({
  useCategories: () => [category],
  useCategoryById: () => category
}));

mock.module('@/features/server/hooks', () => ({
  useCan: () => () => true,
  useCategoryUnreadData: () => ({ unreadCount: 0, hasUnreadMentions: false }),
  useHasVisibleChannelsInCategory: () => true,
  useActiveDmChannelId: () => undefined,
  useUnreadMessagesCount: () => 0
}));

mock.module('@/features/server/channels/hooks', () => ({
  useChannels: () => []
}));

mock.module('@/features/server/users/hooks', () => ({
  useOwnUserId: () => 1,
  useUserById: () => undefined,
  useUsers: () => []
}));

mock.module('@/features/app/actions', () => ({
  setSelectedDmChannelId: () => undefined
}));

mock.module('@/features/server/actions', () => ({
  setDmsOpen: () => undefined
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: () => undefined,
  requestConfirmation: async () => true
}));

mock.module('@/lib/trpc', () => ({
  cleanup: () => {},
  getTRPCClient: () => ({
    dms: { get: { query: async () => [] } }
  })
}));

mock.module('@/components/user-avatar', () => ({
  UserAvatar: () => <span data-testid="user-avatar" />
}));

mock.module('@/components/left-sidebar/channels', () => ({
  Channels: () => null
}));

mock.module('@/components/left-sidebar/hooks', () => ({
  useCategoryExpanded: () => ({
    expand: noop,
    expanded: true,
    toggleExpanded: noop
  })
}));

mock.module('@/components/left-sidebar/use-sidebar-dnd', () => ({
  useCategoryAutoExpand: () => undefined
}));

// the drag and drop shell portals the overlay, the server renderer cannot
mock.module('@/components/left-sidebar/sidebar-dnd', () => ({
  SidebarDnd: ({ children }: { children: ReactNode }) => <>{children}</>
}));

mock.module('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined
  })
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { sidebar: sidebarEn } },
  interpolation: { escapeValue: false }
});

const { DirectMessages } = await import('../direct-messages');
const { Categories } = await import('../categories');

const directChannelsHtml = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DirectMessages />
  </I18nextProvider>
);

const categoriesHtml = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Categories />
  </I18nextProvider>
);

console.log(`__DIRECT_CHANNELS__${directChannelsHtml}`);
console.log(`__CATEGORIES__${categoriesHtml}`);
