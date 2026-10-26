// Renders the invites settings section and prints the markup. The test runs
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

const creator = {
  id: 1,
  name: 'aria',
  bio: null,
  profileColor: '#5865F2',
  avatarId: null,
  bannerId: null,
  createdAt: now - 1000 * 60 * 60 * 24 * 30,
  updatedAt: now,
  lastLoginAt: now,
  banned: false,
  roleIds: [1]
};

const community = {
  id: 1,
  code: 'community',
  creatorId: creator.id,
  roleId: 1,
  maxUses: null,
  uses: 3,
  expiresAt: now + 1000 * 60 * 60 * 24 * 7,
  createdAt: now - 1000 * 60 * 60 * 24,
  creator,
  role: { id: 1, name: 'Moderator', color: '#5865F2' }
};

const team = {
  ...community,
  id: 2,
  code: 'team',
  roleId: null,
  role: null,
  maxUses: 10,
  uses: 3,
  expiresAt: null,
  creator: { ...creator, name: 'jules' }
};

const expired = {
  ...community,
  id: 3,
  code: 'expired',
  expiresAt: now - 1000 * 60 * 60
};

const invites =
  mode === 'empty'
    ? []
    : mode === 'expired'
      ? [expired]
      : mode === 'long'
        ? [
            {
              ...community,
              code: 'a-very-long-invite-code-that-does-not-fit-into-the-link-cell'
            }
          ]
        : [community, team];

mock.module('@/features/server/admin/hooks', () => ({
  useAdminInvites: () => ({
    invites,
    loading: false,
    refetch: async () => undefined
  })
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: () => undefined,
  requestConfirmation: async () => true
}));

mock.module('@/lib/trpc', () => ({
  getTRPCClient: () => ({
    invites: { delete: { mutate: async () => undefined } }
  })
}));

mock.module('@/helpers/get-file-url', () => ({
  getUrlFromServer: () => 'https://discord.rnd332.com',
  getFileUrl: () => ''
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

const { Invites } = await import('../index');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <Invites />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
