import { useIsConnected, useIsReconnecting } from '@/features/server/hooks';
import { LoadingApp } from '@/screens/loading-app';
import { ServerView } from '@/screens/server-view';
import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/app')({
  component: AppRoute
});

function AppRoute() {
  const { t } = useTranslation('connect');
  const isConnected = useIsConnected();
  const isReconnecting = useIsReconnecting();

  // the server view needs the connection of the browser, it cannot be rendered on the server
  if (!isConnected && !isReconnecting) {
    // the stored session is resumed after the document loads, and the view without its
    // data is an empty shell of the app. a reconnection keeps the view instead: the call,
    // the messages and the overlays of the user live in it
    return (
      <ClientOnly fallback={<LoadingApp text={t('loadingApp')} />}>
        <LoadingApp text={t('loggingInAutomatically')} />
      </ClientOnly>
    );
  }

  return (
    <ClientOnly fallback={<LoadingApp text={t('loadingApp')} />}>
      <div className="contents" inert={isReconnecting}>
        <ServerView />
      </div>
    </ClientOnly>
  );
}
