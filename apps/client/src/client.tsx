import { exposeServerDebugApi } from '@/features/server/actions';
import { exposePluginStore } from '@/features/server/plugins/plugin-store';
import { exposeLibs, exposeReact } from '@/helpers/exposes';
import { initAppSentry } from '@/helpers/sentry';
import { migrateLegacyStorageKeys } from '@/helpers/storage';
import { i18nReady, prepareLanguageCookie } from '@/i18n';
import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

// the browser gets the helpers of the console and the storage of the older
// versions before the first render
migrateLegacyStorageKeys();

initAppSentry();

exposeReact();
exposeLibs();
exposePluginStore();
exposeServerDebugApi();

// the server renders every request in the language of the request, and the
// choice of the user of the older versions lives in the storage of the browser
// only. the page asks for itself again with the cookie of the language, then
// the server renders it in the language of the user and the text of the server
// and the text of the browser match
if (prepareLanguageCookie()) {
  window.location.reload();
} else {
  await i18nReady;

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>
    );
  });
}
