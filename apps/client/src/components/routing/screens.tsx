import { ReconnectingOverlay } from '@/components/reconnecting-overlay';
import { ServerUpdateNotice } from '@/components/reconnecting-overlay/server-update-notice';
import {
  useIsAppLoading,
  useIsAutoConnecting,
  useIsPluginsLoading
} from '@/features/app/hooks';
import {
  useDisconnectInfo,
  useIsConnected,
  useIsReconnecting
} from '@/features/server/hooks';
import { memoizeImport, warmImportsWhenIdle } from '@/helpers/prefetch';
import { LoadingApp } from '@/screens/loading-app';
import { DisconnectCode } from '@dodecagon/shared';
import { lazy, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

const loadConnect = memoizeImport(() => import('@/screens/connect'));
const loadDisconnected = memoizeImport(() => import('@/screens/disconnected'));
const loadServerView = memoizeImport(() => import('@/screens/server-view'));

const Connect = lazy(() =>
  loadConnect().then(({ Connect }) => ({ default: Connect }))
);
const Disconnected = lazy(() =>
  loadDisconnected().then(({ Disconnected }) => ({ default: Disconnected }))
);
const ServerView = lazy(() =>
  loadServerView().then(({ ServerView }) => ({ default: ServerView }))
);

warmImportsWhenIdle([loadConnect, loadDisconnected, loadServerView]);

// the screens live in the routes of the router now. this component renders them
// without a router, the tests of the interface use it to look at one screen
const AppScreens = memo(() => {
  const { t } = useTranslation('connect');
  const isConnected = useIsConnected();
  const isAppLoading = useIsAppLoading();
  const isPluginsLoading = useIsPluginsLoading();
  const disconnectInfo = useDisconnectInfo();
  const isAutoConnecting = useIsAutoConnecting();
  const isReconnecting = useIsReconnecting();

  if (isAppLoading || isPluginsLoading) {
    return (
      <LoadingApp text={isAppLoading ? t('loadingApp') : t('loadingPlugins')} />
    );
  }

  if (!isConnected && !isReconnecting) {
    if (isAutoConnecting) {
      return <LoadingApp text={t('loggingInAutomatically')} />;
    }

    if (
      disconnectInfo &&
      (!disconnectInfo.wasClean ||
        disconnectInfo.code === DisconnectCode.KICKED ||
        disconnectInfo.code === DisconnectCode.BANNED ||
        disconnectInfo.code === DisconnectCode.SERVER_SHUTDOWN)
    ) {
      return (
        <Suspense fallback={<LoadingApp text={t('loadingApp')} />}>
          <Disconnected info={disconnectInfo} />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<LoadingApp text={t('loadingApp')} />}>
        <Connect />
      </Suspense>
    );
  }

  return (
    <>
      {isReconnecting && <ReconnectingOverlay />}
      {!isReconnecting && <ServerUpdateNotice />}

      <div className="contents" inert={isReconnecting}>
        <Suspense fallback={<LoadingApp text={t('loadingApp')} />}>
          <ServerView />
        </Suspense>
      </div>
    </>
  );
});

export { AppScreens };
