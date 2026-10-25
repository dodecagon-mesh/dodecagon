// Renders the actions of the voice stage and prints the markup. The test runs
// this in its own process: bun keeps the first mock.module registration of a
// path for the whole test run, so the mocks of the other test files would leak in.
import commonEn from '@/i18n/locales/en/common.json';
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
    location: { href: 'http://localhost' },
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

const mode = process.argv[2] ?? 'expanded';

const users = [
  { id: 2, name: 'aria', status: 'offline' },
  { id: 3, name: 'jules', status: 'offline' },
  { id: 4, name: 'mika', status: 'offline' }
];

mock.module('@/features/server/users/hooks', () => ({
  useUserById: (userId: number) => users.find((user) => user.id === userId),
  useUsers: () => users,
  useIsOwnUser: (userId: number) => userId === 1
}));

// the demo fills the stage while it is pinned, the users shrink to the strip
const pinnedCards: Record<string, unknown> = {
  expanded: { id: 'screen-share-2', type: 'screen-share', userId: 2 },
  minified: { id: 'user-3', type: 'user', userId: 3 },
  unpinned: undefined
};

mock.module('@/features/server/voice/hooks', () => ({
  usePinnedCard: () => pinnedCards[mode],
  useScreenViewers: () => ({ 2: { viewerIds: [3, 4] } })
}));

mock.module('@/features/app/hooks', () => ({
  useVoiceChatSidebar: () => ({ isOpen: false, channelId: 2 }),
  usePluginSlotDebug: () => false,
  useShortcutBindings: () => []
}));

mock.module('@/features/server/hooks', () => ({
  useHasUnreadMentions: () => false,
  useUnreadMessagesCount: () => 0,
  useCan: () => () => true,
  useHiddenPluginComponents: () => [],
  usePublicServerSettings: () => undefined,
  useUserRoles: () => []
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { common: commonEn, topbar: topbarEn } },
  interpolation: { escapeValue: false }
});

const { VoiceStageActions } = await import('../voice-stage-actions');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <VoiceStageActions channelId={2} isActive />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
