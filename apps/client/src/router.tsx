import { RouteError } from '@/components/error-boundary/route-error';
import { captureError } from '@/helpers/sentry';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'render',
    defaultPreloadDelay: 0,
    defaultPreloadStaleTime: 30_000,
    defaultPreloadGcTime: 10 * 60_000,
    // a failed loader or route component keeps the app on a screen the user can
    // recover from, instead of the bare error screen of the router
    defaultErrorComponent: RouteError,
    defaultOnCatch: (error) => captureError(error, { area: 'router' })
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
