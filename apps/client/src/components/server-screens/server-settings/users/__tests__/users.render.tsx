// Renders the users settings section and prints the markup. The test runs
// this in its own process: bun keeps the first mock.module registration of a
// path for the whole test run, so the mocks of the other test files would
// leak in.
import settingsEn from '@/i18n/locales/en/settings.json';
import * as dodecagonUi from '@dodecagon/ui';
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

const mode = process.argv[2] ?? 'default';

const now = Date.now();

const aria = {
  id: 1,
  name: 'aria',
  bio: 'Keeps the server calm',
  profileColor: '#5865F2',
  avatarId: null,
  bannerId: null,
  createdAt: now - 1000 * 60 * 60 * 24 * 30,
  updatedAt: now,
  lastLoginAt: now - 1000 * 60 * 5,
  banned: false,
  roleIds: [1]
};

const jules = {
  ...aria,
  id: 2,
  name: 'jules',
  bio: null,
  roleIds: []
};

const longName = {
  ...aria,
  id: 3,
  name: 'a-nickname-that-is-way-too-long-for-the-member-cell',
  bio: 'A biography that is much longer than the member cell of the users table'
};

const users =
  mode === 'empty'
    ? []
    : mode === 'long'
      ? [longName]
      : mode === 'own'
        ? [aria]
        : [aria, jules];

const rolesByUser: Record<
  number,
  { id: number; name: string; color: string }[]
> = {
  1: [{ id: 1, name: 'Moderator', color: '#5865F2' }],
  2: [],
  3: [{ id: 1, name: 'Moderator', color: '#5865F2' }]
};

const statusByUser: Record<number, string> = {
  1: 'online',
  2: 'offline',
  3: 'idle'
};

mock.module('@/features/server/admin/hooks', () => ({
  useAdminUsers: () => ({
    users,
    loading: false,
    refetch: async () => undefined
  })
}));

mock.module('@/features/server/hooks', () => ({
  useUserRoles: (userId: number) => rolesByUser[userId] ?? []
}));

mock.module('@/features/server/users/hooks', () => ({
  useOwnUserId: () => (mode === 'own' ? aria.id : 999),
  useUserStatus: (userId: number) => statusByUser[userId] ?? 'offline'
}));

mock.module('@/components/user-avatar', () => ({
  UserAvatar: ({
    userId,
    className
  }: {
    userId: number | null;
    className?: string;
  }) => (
    <span
      data-testid="user-avatar"
      data-user-id={userId ?? ''}
      className={className}
    />
  )
}));

mock.module('@/features/app/actions', () => ({
  setModViewOpen: () => undefined
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: () => undefined,
  requestConfirmation: async () => true
}));

// the dropdown content is portalled and stays closed in static markup, so the
// menu is rendered inline to keep the row actions observable
mock.module('@dodecagon/ui', () => ({
  ...dodecagonUi,
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-content">{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-item">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu-trigger">{children}</div>
  )
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { settings: settingsEn } },
  interpolation: { escapeValue: false }
});

const { Users } = await import('../index');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Users />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
