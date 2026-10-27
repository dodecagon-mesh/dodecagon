import { readRequestContext } from '@/features/server/request-context';
import { getServerInfo } from '@/features/server/server-functions';
import { retryingFetch } from '@/helpers/retrying-fetch';
import { Connect } from '@/screens/connect';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/connect')({
  loader: async ({ location }) => {
    const search = location.searchStr;
    const [info, requestContext] = await Promise.all([
      getServerInfo({ fetch: retryingFetch }),
      readRequestContext()
    ]);

    return {
      info,
      search,
      oidcError: new URLSearchParams(search).get('oidc_error'),
      isSecureContext: requestContext.isSecure
    };
  },
  component: ConnectRoute
});

function ConnectRoute() {
  const { info, search, oidcError, isSecureContext } = Route.useLoaderData();

  return (
    <Connect
      info={info}
      search={search}
      oidcError={oidcError}
      isSecureContext={isSecureContext}
    />
  );
}
