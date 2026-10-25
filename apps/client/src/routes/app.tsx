import { useIsReconnecting } from '@/features/server/hooks';
import { LoadingApp } from '@/screens/loading-app';
import { ServerView } from '@/screens/server-view';
import { ClientOnly, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/app')({
  component: AppRoute
});

function AppRoute() {
  const isReconnecting = useIsReconnecting();
  // the server view needs the connection of the browser, it cannot be rendered
  // on the server
  return (
    <ClientOnly fallback={<LoadingApp text="Loading" />}>
      <div className="contents" inert={isReconnecting}>
        <ServerView />
      </div>
    </ClientOnly>
  );
}
