import { ReconnectingOverlay } from '@/components/reconnecting-overlay';
import { ServerUpdateNotice } from '@/components/reconnecting-overlay/server-update-notice';
import { useIsAppLoading, useIsPluginsLoading } from '@/features/app/hooks';
import {
  useDisconnectInfo,
  useIsConnected,
  useIsReconnecting
} from '@/features/server/hooks';
import { hasStoredSession } from '@/helpers/stored-session';
import { DisconnectCode } from '@dodecagon/shared';
import { useNavigate } from '@tanstack/react-router';
import { memo, useEffect } from 'react';
import { useDocumentTitle } from './hooks/use-document-title';
import { useOidcAutoRedirect } from './hooks/use-oidc-auto-redirect';

// the screens live in the routes now, this component only decides which one
// the browser should show
const Routing = memo(() => {
  const isConnected = useIsConnected();
  const isAppLoading = useIsAppLoading();
  const isPluginsLoading = useIsPluginsLoading();
  const disconnectInfo = useDisconnectInfo();
  const isReconnecting = useIsReconnecting();
  const navigate = useNavigate();

  useDocumentTitle();
  useOidcAutoRedirect();

  useEffect(() => {
    if (isAppLoading || isPluginsLoading) return;

    if (isConnected || isReconnecting) {
      void navigate({ to: '/app' });

      return;
    }

    const isDisconnected =
      disconnectInfo &&
      (!disconnectInfo.wasClean ||
        disconnectInfo.code === DisconnectCode.KICKED ||
        disconnectInfo.code === DisconnectCode.BANNED ||
        disconnectInfo.code === DisconnectCode.SERVER_SHUTDOWN);

    if (isDisconnected) {
      void navigate({ to: '/disconnected' });

      return;
    }

    // the browser resumes a stored session right after the hydration. until it does, the
    // form of the sign in is the wrong screen, and on a slow link it is the screen the user
    // sees after every refresh of a session that is valid. the tokens are gone once the
    // resume fails, so a session that cannot come back still lands on the form
    if (hasStoredSession()) return;

    void navigate({ to: '/connect' });
  }, [
    disconnectInfo,
    isAppLoading,
    isConnected,
    isPluginsLoading,
    isReconnecting,
    navigate
  ]);

  if (isReconnecting) {
    return <ReconnectingOverlay />;
  }

  return isConnected ? <ServerUpdateNotice /> : null;
});

export { Routing };
