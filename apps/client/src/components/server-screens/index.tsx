import { closeOverlay } from '@/features/overlays/actions';
import { useOverlay } from '@/features/overlays/hooks';
import { useIsConnected } from '@/features/server/hooks';
import { memoizeImport, warmImportsWhenIdle } from '@/helpers/prefetch';
import {
  createElement,
  lazy,
  memo,
  Suspense,
  useEffect,
  useState,
  type ComponentType
} from 'react';
import { createPortal } from 'react-dom';
import { ServerScreen } from './screens';

const loadServerSettings = memoizeImport(() => import('./server-settings'));
const loadChannelSettings = memoizeImport(() => import('./channel-settings'));
const loadUserSettings = memoizeImport(() => import('./user-settings'));
const loadCategorySettings = memoizeImport(() => import('./category-settings'));
const ServerSettings = lazy(() =>
  loadServerSettings().then((m) => ({ default: m.ServerSettings }))
);
const ChannelSettings = lazy(() =>
  loadChannelSettings().then((m) => ({ default: m.ChannelSettings }))
);
const UserSettings = lazy(() =>
  loadUserSettings().then((m) => ({ default: m.UserSettings }))
);
const CategorySettings = lazy(() =>
  loadCategorySettings().then((m) => ({ default: m.CategorySettings }))
);

const ScreensMap = {
  [ServerScreen.SERVER_SETTINGS]: ServerSettings,
  [ServerScreen.CHANNEL_SETTINGS]: ChannelSettings,
  [ServerScreen.USER_SETTINGS]: UserSettings,
  [ServerScreen.CATEGORY_SETTINGS]: CategorySettings
};

let warmedScreens = false;

const ServerScreensProvider = memo(() => {
  const overlay = useOverlay();
  const isConnected = useIsConnected();

  // the portal root belongs to the document shell, so it is only known once the
  // tree is mounted
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.getElementById('portal'));
  }, []);

  useEffect(() => {
    // settings screens are unreachable before the session exists, warming them
    // from the sign in screen downloads the app on a link that has not asked for it
    if (!isConnected || warmedScreens) return;

    warmedScreens = true;

    warmImportsWhenIdle([
      loadServerSettings,
      loadChannelSettings,
      loadUserSettings,
      loadCategorySettings
    ]);
  }, [isConnected]);

  if (!overlay || overlay.kind !== 'serverScreen') return null;

  const Screen = ScreensMap[overlay.name];
  if (!Screen) return null;
  if (!portalRoot) return null;

  return createPortal(
    <Suspense fallback={null}>
      {createElement(
        Screen as unknown as ComponentType<Record<string, unknown>>,
        {
          ...overlay.props,
          isOpen: true,
          close: closeOverlay
        }
      )}
    </Suspense>,
    portalRoot
  );
});

export { ServerScreensProvider };
