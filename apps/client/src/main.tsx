import { Toaster } from '@dodecagon/ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter/wght-italic.css';
import 'prosemirror-view/style/prosemirror.css';
import { DebugInfo } from './components/debug-info/index.tsx';
import { StoreDebug } from './components/debug/store-debug.tsx';
import { DevicesProvider } from './components/devices-provider/index.tsx';
import { DialogsProvider } from './components/dialogs/index.tsx';
import { GlobalErrorBoundary } from './components/error-boundary/global-error-boundary.tsx';
import { HotkeysController } from './components/hotkeys-controller/index.tsx';
import { PluginsController } from './components/plugins-controller/index.tsx';
import { AutoLoginController } from './components/routing/auto-login-controller.tsx';
import { AppScreens } from './components/routing/screens.tsx';
import { ServerScreensProvider } from './components/server-screens/index.tsx';
import { ThemeProvider } from './components/theme-provider/index.tsx';
import { useTheme } from './components/theme-provider/use-theme.ts';
import { loadApp } from './features/app/actions.ts';
import { LocalStorageKey } from './helpers/storage.ts';
import { useStrictEffect } from './hooks/use-strict-effect.ts';
import './index.css';

// the toast has to follow the theme the user picked, and only the app knows it,
// so the mode is resolved here instead of inside packages/ui
const AppToaster = () => {
  const { resolvedTheme } = useTheme();

  return <Toaster theme={resolvedTheme.mode} />;
};

const Shell = ({ children }: { children?: React.ReactNode }) => {
  // the app is only loaded in the browser, the server hands the screen of the
  // route with the data of the request
  useStrictEffect(() => {
    loadApp();
  }, []);

  return (
    <ThemeProvider
      defaultTheme="dark"
      storageKey={LocalStorageKey.VITE_UI_THEME}
    >
      <GlobalErrorBoundary>
        <DebugInfo />
        <AppToaster />
        <StoreDebug />
        <HotkeysController />
        <PluginsController />
        <DialogsProvider />
        <ServerScreensProvider />
        <AutoLoginController />
        {children}
      </GlobalErrorBoundary>
    </ThemeProvider>
  );
};

// everything in here needs a browser, the root route renders it only after the
// hydration
export function ClientShell() {
  return <Shell />;
}

// the tests of the interface render the app without a router, so the screens
// are chosen the old way
export function ClientApp() {
  return (
    <DevicesProvider>
      <Shell>
        <AppScreens />
      </Shell>
    </DevicesProvider>
  );
}
