// Renders the message composer and prints the markup. The test runs this in its
// own process: bun keeps the first mock.module registration of a path for the
// whole test run, so the mocks of the other test files would leak in.
import commonEn from '@/i18n/locales/en/common.json';
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

const mode = process.argv[2] ?? 'empty';

const displayItems =
  mode === 'attachment'
    ? [
        {
          id: 'image-1',
          name: 'image.png',
          size: 471244,
          extension: '.png',
          previewUrl: 'blob:image'
        }
      ]
    : [];

mock.module('@/features/server/channels/hooks', () => ({
  useChannelById: () => ({ id: 1, name: 'general', isDm: false })
}));

mock.module('@/features/server/hooks', () => ({
  useCan: () => () => true,
  useChannelCan: () => () => true,
  usePublicServerSettings: () => ({
    storageFileSharingInDirectMessages: true
  })
}));

mock.module('@/features/server/plugins/hooks', () => ({
  useFlatPluginCommands: () => [],
  usePluginMetadata: () => undefined
}));

mock.module('@/features/server/users/hooks', () => ({
  useUserById: () => undefined
}));

mock.module('@/hooks/use-upload-files', () => ({
  useUploadFiles: () => ({
    files: [],
    displayItems,
    removeFile: noop,
    clearFiles: noop,
    uploading: false,
    openFileDialog: noop,
    fileInputProps: {}
  })
}));

mock.module('@/components/tiptap-input', () => ({
  TiptapInput: () => <div data-tiptap-input />
}));

mock.module('@/components/emoji-picker', () => ({
  EmojiPicker: ({ children }: { children?: React.ReactNode }) => children
}));

mock.module('@/components/plugin-slot-renderer', () => ({
  PluginSlotRenderer: () => null
}));

mock.module('@/components/channel-view/text/use-draft-messages', () => ({
  getDraftMessage: () => 'hello',
  setDraftMessage: noop,
  flushDraftMessages: noop
}));

const i18n = i18next.createInstance();

await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { common: commonEn } },
  interpolation: { escapeValue: false }
});

const { MessageCompose } = await import('../index');

const html = renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <MessageCompose
      channelId={1}
      draftKey="render-test"
      onSend={() => true}
      onTyping={noop}
      typingUsers={[]}
    />
  </I18nextProvider>
);

console.log(`__MARKUP__${html}`);
