import { resetApp } from '@/features/app/actions';
import { resetDialogs } from '@/features/dialogs/actions';
import { resetServerScreens } from '@/features/server-screens/actions';
import {
  cancelReconnect,
  reconnectToServer,
  resetServerState,
  setDisconnectInfo
} from '@/features/server/actions';
import { SoundType } from '@/features/server/types';
import { suppressOidcAutoRedirect } from '@/helpers/oidc';
import { playSound } from '@/helpers/sounds';
import {
  getSessionStorageItem,
  LocalStorageKey,
  removeLocalStorageItem,
  removeSessionStorageItem,
  SessionStorageKey,
  setLocalStorageItemBool
} from '@/helpers/storage';
import { pushVoiceDebugEvent } from '@/helpers/voice-debug';
import {
  DisconnectCode,
  type AppRouter,
  type TConnectionParams
} from '@dodecagon/shared';
import { createTRPCProxyClient, createWSClient, wsLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';

let wsClient: ReturnType<typeof createWSClient> | null = null;
let trpc: ReturnType<typeof createTRPCProxyClient<AppRouter>> | null = null;
let currentHost: string | null = null;
let isCleaningUp = false;

// Firefox fires WebSocket onClose during page refresh; Chrome does not. When navigating away,
// we must not clear auto-login localStorage or it will be lost on refresh in Firefox.
let isNavigatingAway = false;

// the server imports the module too and it has no page to listen on
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    isNavigatingAway = true;
  });
}

const isTerminalClose = (code: number) =>
  code === DisconnectCode.KICKED ||
  code === DisconnectCode.BANNED ||
  code === DisconnectCode.AUTHENTICATION_FAILED;

const initializeTRPC = (host: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  const client = createWSClient({
    url: `${protocol}://${host}`,
    onOpen: () => {
      pushVoiceDebugEvent('ws', 'websocket open', { host });
    },
    onError: (event) => {
      pushVoiceDebugEvent('error', 'websocket error', { type: event?.type });
    },
    // @ts-expect-error - the onclose type is not correct in trpc
    onClose: (cause?: CloseEvent) => {
      const info = {
        code: cause?.code ?? DisconnectCode.UNEXPECTED,
        reason: cause?.reason ?? '',
        wasClean: cause?.wasClean ?? false,
        time: new Date()
      };

      // recorded before the early return: a close during teardown or navigation is still
      // the thing that ended an active call
      pushVoiceDebugEvent('ws', 'websocket closed', {
        ...info,
        isNavigatingAway,
        isCleaningUp
      });

      if (isNavigatingAway || isCleaningUp || wsClient !== client) return;

      if (isTerminalClose(info.code)) {
        cleanup();
        setDisconnectInfo(info);

        if (!info.wasClean) {
          playSound(SoundType.SERVER_DISCONNECTED);
        }

        return;
      }

      closeClient();
      reconnectToServer(info, { transportClosed: true });
    },
    connectionParams: async (): Promise<TConnectionParams> => {
      return {
        token: getSessionStorageItem(SessionStorageKey.TOKEN) || ''
      };
    },
    keepAlive: {
      enabled: true,
      intervalMs: 30_000,
      pongTimeoutMs: 5_000
    }
  });
  wsClient = client;

  trpc = createTRPCProxyClient<AppRouter>({
    links: [wsLink({ client: wsClient })]
  });

  currentHost = host;

  return trpc;
};

const connectToTRPC = (host: string) => {
  if (trpc && currentHost === host) {
    return trpc;
  }

  return initializeTRPC(host);
};

const getTRPCClient = () => {
  if (!trpc) {
    throw new Error('TRPC client is not initialized');
  }

  return trpc;
};

const closeClient = () => {
  const client = wsClient;
  // Detach before close: its delayed onClose must not tear down a newer client.
  wsClient = null;
  trpc = null;
  currentHost = null;
  client?.close();
};

const cleanup = ({ invalidateCredentials = true } = {}) => {
  if (isCleaningUp) {
    return;
  }

  isCleaningUp = true;

  cancelReconnect();
  closeClient();

  // A password-dialog cancellation ends the connection, not the account login.
  // Outages never enter cleanup; logout and confirmed invalidation remove tokens.
  if (invalidateCredentials) {
    removeLocalStorageItem(LocalStorageKey.AUTO_LOGIN_TOKEN);
    setLocalStorageItemBool(LocalStorageKey.AUTO_LOGIN, false);
    removeSessionStorageItem(SessionStorageKey.TOKEN);
  }
  suppressOidcAutoRedirect();

  resetServerScreens();
  resetServerState();
  resetDialogs();
  resetApp();

  isCleaningUp = false;
};

export type TRouterOutputs = inferRouterOutputs<AppRouter>;

export { cleanup, connectToTRPC, getTRPCClient, type AppRouter };
