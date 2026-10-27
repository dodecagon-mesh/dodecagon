import { DevicesProvider } from '@/components/devices-provider';
import { Routing } from '@/components/routing';
import { hydrateAppFromStorage } from '@/features/app/slice';
import { readRequestContext } from '@/features/server/request-context';
import { hydrateServerFromStorage } from '@/features/server/slice';
import { createStore, store } from '@/features/store';
import { StoreProvider } from '@/features/store-context';
import { RenderClockProvider } from '@/helpers/render-clock';
import {
  createI18n,
  getLanguageResources,
  getSavedLanguage,
  whenI18nReady
} from '@/i18n';
import { I18nProvider } from '@/i18n/i18n-context';
import {
  ClientOnly,
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState
} from '@tanstack/react-router';
import { lazy, useEffect, useState } from 'react';
import '../index.css';

// the shell of the app needs a browser, the server only renders the screen of
// the route
const ClientShell = lazy(() =>
  import('@/main').then((module) => ({ default: module.ClientShell }))
);

export const Route = createRootRoute({
  loader: async () => {
    const requestContext = await readRequestContext();
    const instance = createI18n(requestContext.language);

    await whenI18nReady(instance);

    const resources = getLanguageResources(instance, requestContext.language);

    return { ...requestContext, resources };
  },
  // the loader is not stale for a minute, so the browser does not ask the server
  // again right after the hydration
  staleTime: 60_000,
  component: RootComponent,
  shellComponent: RootDocument
});

function RootComponent() {
  const { language, resources, now } = Route.useLoaderData();
  const isDesignSystem = useRouterState({
    select: (state) =>
      state.location.pathname.replace(/\/$/, '') === '/design-system'
  });
  // the server renders every request with its own store, the browser keeps the
  // one instance for the whole session
  const [requestStore] = useState(() =>
    typeof window === 'undefined' ? createStore() : store
  );
  const [instance] = useState(() => createI18n(language, resources));

  useEffect(() => {
    // the flags of the storage belong to the browser, the first render of the
    // server and of the browser have to be the same
    requestStore.dispatch(hydrateAppFromStorage());
    requestStore.dispatch(hydrateServerFromStorage());
  }, [requestStore]);

  useEffect(() => {
    // the html of the server is alive before the browser takes over, the tests
    // of the browser have to know when the form starts to react
    document.documentElement.dataset.hydrated = 'true';
  }, []);

  useEffect(() => {
    // the browser knows the language of the user, the server could only guess it
    // from the header of the request
    const savedLanguage = getSavedLanguage();

    if (savedLanguage && savedLanguage !== instance.language) {
      void instance.changeLanguage(savedLanguage);
    }
  }, [instance]);

  return (
    <StoreProvider value={requestStore}>
      <I18nProvider value={instance}>
        <RenderClockProvider now={now}>
          {/* Routed controls and shell settings must share one discovery state. */}
          {isDesignSystem ? (
            <Outlet />
          ) : (
            <DevicesProvider>
              <ClientOnly>
                <ClientShell />
              </ClientOnly>
              <Routing />
              <Outlet />
            </DevicesProvider>
          )}
        </RenderClockProvider>
      </I18nProvider>
    </StoreProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <div id="portal" />
        <div id="imagePortal" />
        <Scripts />
      </body>
    </html>
  );
}
