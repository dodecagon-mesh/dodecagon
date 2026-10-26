// Renders the channel permissions settings section and prints the markup. The
// test runs this in its own process: bun keeps the first mock.module
// registration of a path for the whole test run, so the mocks of the other
// test files would leak in.
import permissionsEn from '@/i18n/locales/en/permissions.json';
import settingsEn from '@/i18n/locales/en/settings.json';
import { ChannelPermission } from '@dodecagon/shared';
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

const channelId = 7;

const roles = [
  { id: 1, name: 'Moderator', color: '#F5BE72' },
  { id: 2, name: 'Member', color: '#5865F2' }
];

const users = [{ id: 2, name: 'rnd332' }];

const rolePermissions = [
  {
    channelId,
    roleId: 1,
    permission: 'VIEW_CHANNEL',
    allow: true,
    createdAt: 0,
    updatedAt: 0
  },
  {
    channelId,
    roleId: 1,
    permission: 'SEND_MESSAGES',
    allow: false,
    createdAt: 0,
    updatedAt: 0
  }
];

const userPermissions = [
  {
    channelId,
    userId: 2,
    permission: 'VIEW_CHANNEL',
    allow: true,
    createdAt: 0,
    updatedAt: 0
  }
];

const isEmpty = mode === 'empty';

mock.module('@/features/server/admin/hooks', () => ({
  useAdminChannelPermissions: () => ({
    rolePermissions: isEmpty ? [] : rolePermissions,
    userPermissions: isEmpty ? [] : userPermissions,
    loading: false,
    refetch: async () => undefined
  })
}));

mock.module('@/features/server/channels/hooks', () => ({
  useChannelById: () => ({
    id: channelId,
    name: 'general',
    type: 'TEXT',
    private: mode !== 'public'
  })
}));

mock.module('@/features/server/roles/hooks', () => ({
  useRoleById: (roleId: number) => roles.find((role) => role.id === roleId),
  useRoles: () => roles
}));

mock.module('@/features/server/users/hooks', () => ({
  useUserById: (userId: number | null) =>
    users.find((user) => user.id === userId),
  useUsers: () => users
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: () => undefined,
  toggleDialog: () => undefined,
  closeOverlay: () => undefined,
  requestConfirmation: async () => true,
  requestTextInput: async () => null
}));

mock.module('@/lib/trpc', () => ({
  getTRPCClient: () => ({
    channels: {
      updatePermissions: { mutate: async () => undefined },
      deletePermissions: { mutate: async () => undefined }
    }
  })
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

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { settings: settingsEn, permissions: permissionsEn } },
  interpolation: { escapeValue: false }
});

const { ChannelPermissions } = await import('../index');
const { Override } = await import('../override');

const html =
  mode === 'editor'
    ? renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <Override
            channelId={channelId}
            overrideId="role-1"
            permissions={[
              { permission: ChannelPermission.VIEW_CHANNEL, allow: true },
              { permission: ChannelPermission.SEND_MESSAGES, allow: false }
            ]}
            setSelectedOverrideId={() => undefined}
            refetch={async () => undefined}
          />
        </I18nextProvider>
      )
    : renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <ChannelPermissions channelId={channelId} />
        </I18nextProvider>
      );

console.log(`__MARKUP__${html}`);
