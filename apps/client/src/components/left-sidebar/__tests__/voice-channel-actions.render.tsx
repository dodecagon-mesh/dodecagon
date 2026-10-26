// Renders the channel rows of the sidebar and prints their markup. The test
// runs this in its own process: bun keeps the first mock.module registration
// of a path for the whole test run, so the mocks of the other test files would
// leak in.
import sidebarEn from '@/i18n/locales/en/sidebar.json';
import { ChannelType, type TChannel } from '@dodecagon/shared';
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
    location: { href: 'http://localhost', search: '' }
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

const textChannel: TChannel = {
  id: 1,
  type: ChannelType.TEXT,
  name: 'general',
  topic: null,
  private: false,
  isDm: false,
  position: 0,
  categoryId: 7,
  createdAt: 0,
  updatedAt: null
};

const voiceChannel: TChannel = {
  id: 2,
  type: ChannelType.VOICE,
  name: 'Lounge',
  topic: null,
  private: false,
  isDm: false,
  position: 1,
  categoryId: 7,
  createdAt: 0,
  updatedAt: null
};

let visibleChannels: TChannel[] = [textChannel];

mock.module('@/features/server/channels/hooks', () => ({
  useChannelById: (channelId: number) =>
    visibleChannels.find((channel) => channel.id === channelId),
  useChannelsByCategoryId: () => visibleChannels,
  useCurrentVoiceChannelId: () => undefined,
  useSelectedChannelId: () => undefined
}));

mock.module('@/features/server/hooks', () => ({
  useCan: () => () => true,
  useChannelCan: () => () => true,
  useHasUnreadMentions: () => false,
  useTypingUsersByChannelId: () => [],
  useUnreadMessagesCount: () => 0,
  useVoiceUsersByChannelId: () => []
}));

mock.module('@/features/server/voice/hooks', () => ({
  useSpeakingState: () => false,
  useVoiceChannelExternalStreamsList: () => []
}));

mock.module('@/features/server/users/hooks', () => ({
  useIsOwnUser: () => false
}));

mock.module('@/features/app/hooks', () => ({
  useIsChannelMuted: () => false
}));

mock.module('@/features/app/actions', () => ({
  openVoiceChatSidebar: noop,
  toggleChannelMuted: noop
}));

mock.module('@/features/overlays/actions', () => ({
  openOverlay: noop,
  requestConfirmation: async () => true
}));

mock.module('@/hooks/use-select-channel', () => ({
  useSelectChannel: () => noop
}));

mock.module('@/lib/trpc', () => ({
  cleanup: noop,
  getTRPCClient: () => ({})
}));

mock.module('@/components/left-sidebar/use-sidebar-dnd', () => ({
  useChannelDragPreview: () => null
}));

mock.module('@/components/plugin-slot-renderer', () => ({
  PluginSlotRenderer: () => null
}));

mock.module('@/components/user-avatar', () => ({
  UserAvatar: () => <span data-testid="user-avatar" />
}));

mock.module('@/components/user-popover', () => ({
  UserPopover: ({ children }: { children: ReactNode }) => <>{children}</>
}));

mock.module(
  '@/components/voice-provider/hooks/use-stream-volume-control',
  () => ({
    useStreamVolumeControl: () => ({
      isMuted: false,
      volume: 1,
      setVolume: noop,
      toggleMute: noop
    })
  })
);

mock.module('@/components/left-sidebar/stream-context-menu', () => ({
  StreamContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>
}));

// the drag and drop needs a browser, the server renderer cannot build it
mock.module('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: noop, isOver: false })
}));

mock.module('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    isDragging: false,
    listeners: {},
    setNodeRef: noop,
    transform: null,
    transition: undefined
  }),
  verticalListSortingStrategy: noop
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { sidebar: sidebarEn } },
  interpolation: { escapeValue: false }
});

const { Channels } = await import('../channels');

const renderChannels = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Channels categoryId={7} />
    </I18nextProvider>
  );

visibleChannels = [textChannel];
const textChannelHtml = renderChannels();

visibleChannels = [voiceChannel];
const voiceChannelHtml = renderChannels();

console.log(`__TEXT_CHANNEL__${textChannelHtml}`);
console.log(`__VOICE_CHANNEL__${voiceChannelHtml}`);
