import { ReconnectingOverlay } from '@/components/reconnecting-overlay';
import { ServerUpdateNotice } from '@/components/reconnecting-overlay/server-update-notice';
import { useIsAppLoading, useIsPluginsLoading } from '@/features/app/hooks';
import {
  useDisconnectInfo,
  useIsConnected,
  useIsReconnecting
} from '@/features/server/hooks';
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
