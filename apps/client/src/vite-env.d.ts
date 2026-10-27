/// <reference types="vite/client" />
/// <reference types="zzfx" />

// Extend the Window interface for global functions
declare global {
  interface Window {
    useToken: (token: string) => Promise<void>;
    dodecagonDebug?: {
      openSoundsModal?: () => void;
      printVoiceStats?: () => void;
    };
    DEBUG?: boolean;

    // plugin store exposed for plugins to use imperatively
    __DODECAGON_STORE__: import('@dodecagon/shared').TPluginStore;

    // libs exposed for plugins to use
    __DODECAGON_EXPOSED_LIBS__: {
      createSelector: typeof import('reselect').createSelector;
      createCachedSelector: typeof import('re-reselect').createCachedSelector;
    };

    // react and react-dom for plugins to use, injected in main.tsx
    __DODECAGON_REACT__: typeof import('react');
    __DODECAGON_REACT_JSX__: typeof import('react/jsx-runtime');
    __DODECAGON_REACT_JSX_DEV__: typeof import('react/jsx-dev-runtime');
    __DODECAGON_REACT_DOM__: typeof import('react-dom');
    __DODECAGON_REACT_DOM_CLIENT__: typeof import('react-dom/client');
  }

  const VITE_APP_VERSION: string;
  const VITE_SERVER_PORT: string;
  const VITE_SENTRY_DSN: string;
  const VITE_SENTRY_ENVIRONMENT: string;
}

// this provides type definitions for i18n setup
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      audio: typeof import('./i18n/locales/en/audio.json');
      'design-system': typeof import('./i18n/locales/en/design-system.json');
      keybindings: typeof import('./i18n/locales/en/keybindings.json');
      common: typeof import('./locales/en/common.json');
      connect: typeof import('./locales/en/connect.json');
      disconnected: typeof import('./locales/en/disconnected.json');
      sidebar: typeof import('./locales/en/sidebar.json');
      topbar: typeof import('./locales/en/topbar.json');
      dialogs: typeof import('./locales/en/dialogs.json');
      settings: typeof import('./locales/en/settings.json');
      permissions: typeof import('./locales/en/permissions.json');
    };
  }
}

export {};
