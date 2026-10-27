import { Dialog } from '@/components/dialogs/dialogs';
import { logDebug } from '@/helpers/browser-logger';
import { getHostFromServer } from '@/helpers/get-file-url';
import { initSentry } from '@/helpers/sentry';
import { playSound } from '@/helpers/sounds';
import {
  getLocalStorageItem,
  getLocalStorageItemBool,
  getSessionStorageItem,
  LocalStorageKey,
  SessionStorageKey,
  setSessionStorageItem
} from '@/helpers/storage';
import { pushVoiceDebugEvent } from '@/helpers/voice-debug';
import { i18n } from '@/i18n';
import { cleanup, connectToTRPC, getTRPCClient } from '@/lib/trpc';
import type { TMessageJumpToTarget } from '@/types';
import {
  type TLocale,
  type TPublicServerSettings,
  type TServerInfo,
  type TServerUpdateState
} from '@dodecagon/shared';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { appSliceActions } from '../app/slice';
import { openOverlay } from '../overlays/actions';
import { store } from '../store';
import {
  channelReadStateByIdSelector,
  isChannelTextVisibleByIdSelector
} from './channels/selectors';
import {
  processPluginComponents,
  setPluginCapabilityAccess,
  setPluginCommands,
  setPluginComponents
} from './plugins/actions';
import { infoSelector } from './selectors';
import { serverSliceActions } from './slice';
import { SoundType, type TDisconnectInfo } from './types';

let unsubscribeFromServer: (() => void) | null = null;
let reconnectGeneration = 0;
const compiledSentryDsn =
  typeof VITE_SENTRY_DSN === 'undefined' ? undefined : VITE_SENTRY_DSN;

export const setServerUpdateState = (state: TServerUpdateState) => {
  store.dispatch(serverSliceActions.setUpdateState(state));
};

export const isAuthenticationFailure = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';

const assertCurrentConnection = (generation: number) => {
  if (generation !== reconnectGeneration) {
    throw new Error('Connection attempt cancelled');
  }
};

export const setConnected = (status: boolean) => {
  store.dispatch(serverSliceActions.setConnected(status));
};

export const resetServerState = () => {
  store.dispatch(serverSliceActions.resetState());
};

export const setDisconnectInfo = (info: TDisconnectInfo | undefined) => {
  store.dispatch(serverSliceActions.setDisconnectInfo(info));
};

export const setDmsOpen = (open: boolean) => {
  store.dispatch(serverSliceActions.setDmsOpen(open));
};

export const setPublicServerSettings = (
  settings: TPublicServerSettings | undefined
) => {
  store.dispatch(serverSliceActions.setPublicSettings(settings));
  initSentry(settings?.sentryDsn ?? compiledSentryDsn);
};

export const setInfo = (info: TServerInfo | undefined) => {
  store.dispatch(serverSliceActions.setInfo(info));
};

export const setActiveFullscreenPluginId = (pluginId: string | undefined) => {
  store.dispatch(serverSliceActions.setActiveFullscreenPluginId(pluginId));
};

export const connect = async () => {
  const generation = reconnectGeneration;
  try {
    const state = store.getState();
    const info = infoSelector(state);

    if (!info) {
      throw new Error('Failed to fetch server info');
    }

    const { serverId } = info;

    const host = getHostFromServer();
    const trpc = await connectToTRPC(host);

    const { hasPassword, handshakeHash } = await trpc.others.handshake.query();
    assertCurrentConnection(generation);

    if (hasPassword) {
      // show password prompt
      openOverlay({
        kind: 'dialog',
        name: Dialog.SERVER_PASSWORD,
        props: { handshakeHash, serverId }
      });
      return;
    }

    const { showWelcomeDialog } = await joinServer(handshakeHash);

    if (showWelcomeDialog) {
      openOverlay({ kind: 'dialog', name: Dialog.WELCOME_PROFILE_SETUP });
    }
  } catch (error) {
    if (generation === reconnectGeneration && isAuthenticationFailure(error)) {
      cleanup();
    }
    throw error;
  }
};

export const joinServer = async (handshakeHash: string, password?: string) => {
  const generation = reconnectGeneration;
  const trpc = getTRPCClient();
  const data = await trpc.others.joinServer.query({
    handshakeHash,
    password,
    locale: i18n.resolvedLanguage as TLocale
  });
  assertCurrentConnection(generation);

  logDebug('joinServer', data);

  const { initSubscriptions } = await import('./subscriptions');

  try {
    unsubscribeFromServer?.();
  } catch (error) {
    logDebug('failed to unsubscribe stale subscriptions', error);
  }
  assertCurrentConnection(generation);

  store.dispatch(serverSliceActions.setInitialData(data));
  initSentry(data.publicSettings?.sentryDsn ?? compiledSentryDsn);
  unsubscribeFromServer = initSubscriptions();

  setPluginCommands(data.commands);
  setPluginCapabilityAccess(data.pluginCapabilityAccess);

  const components = await processPluginComponents(
    data.pluginIdsWithComponents
  );
  assertCurrentConnection(generation);

  setPluginComponents(components);
  cancelReconnect();

  // Only an authenticated response identifies the running server build. Never
  // infer update completion from a closed socket or an elapsed restart timer.
  if (
    data.serverVersion &&
    typeof VITE_APP_VERSION !== 'undefined' &&
    data.serverVersion !== VITE_APP_VERSION &&
    getSessionStorageItem(SessionStorageKey.CLIENT_RELOAD_VERSION) !==
      data.serverVersion
  ) {
    setSessionStorageItem(
      SessionStorageKey.CLIENT_RELOAD_VERSION,
      data.serverVersion
    );
    window.location.reload();
  }

  return {
    showWelcomeDialog: data.showWelcomeDialog
  };
};

export const disconnectFromServer = () => {
  cleanup();
  unsubscribeFromServer?.();
};

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectInFlight = false;

export const cancelReconnect = () => {
  reconnectGeneration += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  reconnectInFlight = false;
};

// Reopening the socket alone cannot restore ctx.authenticated: every new
// transport must handshake and join again before installing subscriptions.
export const reconnectToServer = (
  info: TDisconnectInfo,
  { transportClosed = false } = {}
) => {
  if (transportClosed) {
    // Invalidate every await on the dead socket, including plugin loading after
    // join. Its eventual response must not cancel recovery of the new socket.
    reconnectGeneration += 1;
    reconnectInFlight = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  if (reconnectTimer || reconnectInFlight) return;
  if (!getSessionStorageItem(SessionStorageKey.TOKEN)) return;

  setConnected(false);
  const generation = reconnectGeneration;
  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ]!;
  reconnectAttempt += 1;

  pushVoiceDebugEvent('ws', 'reconnect scheduled', {
    attempt: reconnectAttempt,
    delay,
    code: info.code,
    reason: info.reason
  });
  store.dispatch(
    serverSliceActions.setReconnect({
      attempt: reconnectAttempt,
      nextAttemptAt: Date.now() + delay
    })
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (generation !== reconnectGeneration) return;
    reconnectInFlight = true;
    store.dispatch(
      serverSliceActions.setReconnect({
        attempt: reconnectAttempt,
        nextAttemptAt: null
      })
    );

    try {
      // Password-protected servers may require a fresh password. Their dialog
      // remains available above the waiting overlay without erasing the login.
      await connect();
      reconnectInFlight = false;
    } catch (error) {
      if (generation !== reconnectGeneration) return;
      reconnectInFlight = false;
      logDebug('reconnect attempt failed', error);

      if (isAuthenticationFailure(error)) {
        cleanup();
        setDisconnectInfo(info);
        playSound(SoundType.SERVER_DISCONNECTED);
        return;
      }

      // FORBIDDEN here means an invalid server password/handshake, not an
      // expired account token. Transient failures keep retrying at capped delay.
      reconnectToServer(info);
    }
  }, delay);
};

export const resumeSession = async () => {
  const generation = reconnectGeneration;
  const token =
    getSessionStorageItem(SessionStorageKey.TOKEN) ||
    (getLocalStorageItemBool(LocalStorageKey.AUTO_LOGIN)
      ? getLocalStorageItem(LocalStorageKey.AUTO_LOGIN_TOKEN)
      : null);
  if (!token) return false;

  setSessionStorageItem(SessionStorageKey.TOKEN, token);
  try {
    await connect();
  } catch (error) {
    if (generation !== reconnectGeneration) return true;
    if (isAuthenticationFailure(error)) {
      cleanup();
    } else {
      reconnectToServer({
        code: 1006,
        reason: '',
        wasClean: false,
        time: new Date()
      });
    }
  }
  return true;
};

export const jumpToMessage = (target: TMessageJumpToTarget) => {
  store.dispatch(appSliceActions.setMessageJumpTarget(target));

  if (target.isDm) {
    setDmsOpen(true);
    store.dispatch(appSliceActions.setSelectedDmChannelId(target.channelId));

    return;
  }

  setDmsOpen(false);
  store.dispatch(appSliceActions.setSelectedDmChannelId(undefined));
  store.dispatch(serverSliceActions.setSelectedChannelId(target.channelId));

  const state = store.getState();

  if (isChannelTextVisibleByIdSelector(state, target.channelId)) {
    markChannelAsRead(target.channelId);
  }
};

export const markChannelAsRead = async (
  channelId: number,
  force: boolean = false
) => {
  const state = store.getState();
  const unreadCount = channelReadStateByIdSelector(state, channelId);

  if (!force && unreadCount === 0) {
    return;
  }

  if (unreadCount > 0) {
    store.dispatch(
      serverSliceActions.setChannelReadState({ channelId, count: 0 })
    );
  }

  try {
    const trpc = getTRPCClient();

    await trpc.channels.markAsRead.mutate({ channelId });
  } catch {
    if (unreadCount > 0) {
      store.dispatch(
        serverSliceActions.setChannelReadState({
          channelId,
          count: unreadCount
        })
      );
    }
  }
};

// the server imports the module too, so the debug api is exposed by the client
// entry point instead of while the module is imported
export const exposeServerDebugApi = () => {
  window.useToken = async (token: string) => {
    const trpc = getTRPCClient();

    try {
      await trpc.others.useSecretToken.mutate({ token });

      toast.success(i18n.t('common:nowServerOwner'));
    } catch {
      toast.error(i18n.t('common:invalidAccessToken'));
    }
  };

  window.dodecagonDebug = {
    ...window.dodecagonDebug,
    openSoundsModal: () => openOverlay({ kind: 'dialog', name: Dialog.SOUNDS })
  };
};
