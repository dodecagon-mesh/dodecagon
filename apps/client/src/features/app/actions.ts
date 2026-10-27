import {
  SHORTCUTS,
  normalizeShortcutOverrides,
  validateShortcutBinding,
  type TShortcutBinding,
  type TShortcutId,
  type TShortcutOverrides
} from '@/components/hotkeys-controller/shortcuts';
import { assertNotificationsPermission } from '@/helpers/assert-notifications-permission';
import { getFileUrl, getUrlFromServer } from '@/helpers/get-file-url';
import { retryingFetch } from '@/helpers/retrying-fetch';
import {
  LocalStorageKey,
  setLocalStorageItem,
  setLocalStorageItemAsJSON,
  setLocalStorageItemBool
} from '@/helpers/storage';
import { i18n } from '@/i18n';
import type { TMessageJumpToTarget } from '@/types';
import type { TServerInfo } from '@dodecagon/shared';
import { toast } from 'sonner';
import { markChannelAsRead, setInfo } from '../server/actions';
import { getServerInfo } from '../server/server-functions';
import { store } from '../store';
import {
  membersPanelOpenSelector,
  mutedChannelIdsSelector,
  pluginSlotDebugSelector,
  shortcutBindingsSelector,
  shortcutOverridesSelector,
  voiceChatChannelIdSelector,
  voiceChatSidebarDataSelector,
  voiceChatSidebarOpenSelector
} from './selectors';
import { appSliceActions } from './slice';

// the stored preferences have to describe the dock that is open, a dock that
// was replaced by another one must not come back on the next reload
const persistDockPreferences = () => {
  const state = store.getState();
  const voiceChatOpen = voiceChatSidebarOpenSelector(state);
  const membersPanelOpen = membersPanelOpenSelector(state);

  setLocalStorageItemBool(
    LocalStorageKey.VOICE_CHAT_SIDEBAR_STATE,
    voiceChatOpen
  );
  setLocalStorageItemBool(
    LocalStorageKey.RIGHT_SIDEBAR_STATE,
    membersPanelOpen
  );
};

export const setAppLoading = (loading: boolean) =>
  store.dispatch(appSliceActions.setAppLoading(loading));

export const setIsAutoConnecting = (isAutoConnecting: boolean) =>
  store.dispatch(appSliceActions.setIsAutoConnecting(isAutoConnecting));

export const setPluginsLoading = (loading: boolean) =>
  store.dispatch(appSliceActions.setLoadingPlugins(loading));

const setOrCreateMeta = (name: string, content: string) => {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }

  el.content = content;
};

const setOrCreateLink = (rel: string, href: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }

  el.href = href;
};

const applyServerBranding = (info: TServerInfo) => {
  document.title = info.name;

  const logoUrl = info.logo
    ? getFileUrl(info.logo)
    : `${getUrlFromServer()}/favicon.ico`;

  setOrCreateLink('icon', logoUrl);
  setOrCreateLink('apple-touch-icon', logoUrl);
  setOrCreateMeta('apple-mobile-web-app-title', info.name);
};

export const fetchServerInfo = async (): Promise<TServerInfo | undefined> => {
  try {
    return await getServerInfo({ fetch: retryingFetch });
  } catch (error) {
    console.error('Error fetching server info:', error);
  }
};

export const loadApp = async () => {
  const info = await fetchServerInfo();

  if (!info) {
    console.error('Failed to load server info during app load');
    toast.error(i18n.t('common:failedLoadServerInfo'));
    return;
  }

  setInfo(info);
  applyServerBranding(info);
  setAppLoading(false);
};

export const setModViewOpen = (isOpen: boolean, userId?: number) =>
  store.dispatch(
    appSliceActions.setModViewOpen({
      modViewOpen: isOpen,
      userId
    })
  );

export const openThreadSidebar = (
  parentMessageId: number,
  channelId: number
) => {
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: true,
      parentMessageId,
      channelId
    })
  );

  persistDockPreferences();
};

export const closeThreadSidebar = () => {
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: false,
      parentMessageId: undefined,
      channelId: undefined
    })
  );

  persistDockPreferences();
};

export const resetApp = () => {
  store.dispatch(
    appSliceActions.setModViewOpen({
      modViewOpen: false,
      userId: undefined
    })
  );
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: false,
      parentMessageId: undefined,
      channelId: undefined
    })
  );
};

export const setAutoJoinLastChannel = (autoJoin: boolean) => {
  store.dispatch(appSliceActions.setAutoJoinLastChannel(autoJoin));

  setLocalStorageItemBool(LocalStorageKey.AUTO_JOIN_LAST_CHANNEL, autoJoin);
};

export const setSelectedDmChannelId = (channelId: number | undefined) => {
  store.dispatch(appSliceActions.setSelectedDmChannelId(channelId));

  if (channelId !== undefined) {
    markChannelAsRead(channelId);
  }
};

export const setBrowserNotifications = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotifications(enabled));
  setLocalStorageItemBool(LocalStorageKey.BROWSER_NOTIFICATIONS, enabled);
};

export const setBrowserNotificationsForMentions = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForMentions(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_MENTIONS,
    enabled
  );
};

export const setBrowserNotificationsForDms = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForDms(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_DMS,
    enabled
  );
};

export const setBrowserNotificationsForReplies = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForReplies(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_REPLIES,
    enabled
  );
};

export const setNotificationSounds = (enabled: boolean) => {
  store.dispatch(appSliceActions.setNotificationSounds(enabled));
  setLocalStorageItemBool(LocalStorageKey.NOTIFICATION_SOUNDS, enabled);
};

export const setMessageSentSound = (enabled: boolean) => {
  store.dispatch(appSliceActions.setMessageSentSound(enabled));
  setLocalStorageItemBool(LocalStorageKey.MESSAGE_SENT_SOUND, enabled);
};

export const setJoinLeaveSounds = (enabled: boolean) => {
  store.dispatch(appSliceActions.setJoinLeaveSounds(enabled));
  setLocalStorageItemBool(LocalStorageKey.JOIN_LEAVE_SOUNDS, enabled);
};

export const setMuteDeafenSounds = (enabled: boolean) => {
  store.dispatch(appSliceActions.setMuteDeafenSounds(enabled));
  setLocalStorageItemBool(LocalStorageKey.MUTE_DEAFEN_SOUNDS, enabled);
};

export const toggleChannelMuted = (channelId: number) => {
  const mutedChannelIds = mutedChannelIdsSelector(store.getState());
  const nextMutedChannelIds = mutedChannelIds.includes(channelId)
    ? mutedChannelIds.filter((id) => id !== channelId)
    : [...mutedChannelIds, channelId];

  store.dispatch(appSliceActions.setMutedChannelIds(nextMutedChannelIds));
  setLocalStorageItemAsJSON(
    LocalStorageKey.MUTED_CHANNEL_IDS,
    nextMutedChannelIds
  );
};

export const setMessageJumpTarget = (
  payload: TMessageJumpToTarget | undefined
) => store.dispatch(appSliceActions.setMessageJumpTarget(payload));

export const openVoiceChatSidebar = (channelId: number) => {
  store.dispatch(
    appSliceActions.setVoiceChatSidebar({ open: true, channelId })
  );

  markChannelAsRead(channelId);
  setLocalStorageItem(
    LocalStorageKey.VOICE_CHAT_SIDEBAR_CHANNEL_ID,
    channelId.toString()
  );

  persistDockPreferences();
};

export const closeVoiceChatSidebar = () => {
  const state = store.getState();
  const voiceChatChannelId = voiceChatChannelIdSelector(state);

  store.dispatch(
    appSliceActions.setVoiceChatSidebar({
      open: false,
      channelId: voiceChatChannelId
    })
  );

  persistDockPreferences();
};

export const setMembersPanelOpen = (open: boolean) => {
  store.dispatch(appSliceActions.setMembersPanelOpen(open));

  persistDockPreferences();
};

export const toggleMembersPanel = () => {
  const state = store.getState();
  const isOpen = membersPanelOpenSelector(state);

  setMembersPanelOpen(!isOpen);
};

export const toggleVoiceChatSidebar = (channelId: number) => {
  const state = store.getState();
  const { isOpen, channelId: voiceChatChannelId } =
    voiceChatSidebarDataSelector(state);

  const isSameChannel = voiceChatChannelId === channelId;

  if (isOpen && isSameChannel) {
    closeVoiceChatSidebar();
  } else {
    openVoiceChatSidebar(channelId);
  }
};

export const assertVoiceChatClose = (channelId: number) => {
  const state = store.getState();
  const { isOpen, channelId: voiceChatChannelId } =
    voiceChatSidebarDataSelector(state);

  if (isOpen && voiceChatChannelId === channelId) {
    closeVoiceChatSidebar();
  }
};

export const togglePluginSlotDebug = () => {
  const state = store.getState();
  const current = pluginSlotDebugSelector(state);
  const next = !current;

  store.dispatch(appSliceActions.setPluginSlotDebug(next));
  setLocalStorageItemBool(LocalStorageKey.PLUGIN_SLOT_DEBUG, next);
};

export const setModifierKeysHeldMap = (keysDown: Record<string, boolean>) => {
  store.dispatch(appSliceActions.setModifierKeysHeldMap(keysDown));
};

const persistShortcutOverrides = (overrides: TShortcutOverrides) => {
  const normalized = normalizeShortcutOverrides(overrides);
  store.dispatch(appSliceActions.setShortcutOverrides(normalized));
  setLocalStorageItemAsJSON(LocalStorageKey.SHORTCUT_OVERRIDES, normalized);
};

export const setShortcutBinding = (
  id: TShortcutId,
  binding: TShortcutBinding | null
) => {
  const state = store.getState();
  const error = validateShortcutBinding(
    id,
    binding,
    shortcutBindingsSelector(state)
  );
  if (error) return error;
  persistShortcutOverrides({
    ...shortcutOverridesSelector(state),
    [id]: binding
  });
};

export const resetShortcutBinding = (id: TShortcutId) => {
  const state = store.getState();
  const shortcut = SHORTCUTS.find((entry) => entry.id === id);
  if (!shortcut) return;
  const error = validateShortcutBinding(
    id,
    shortcut,
    shortcutBindingsSelector(state)
  );
  if (error) return error;
  const overrides = { ...shortcutOverridesSelector(state) };
  delete overrides[id];
  persistShortcutOverrides(overrides);
};

export const resetAllShortcutBindings = () => persistShortcutOverrides({});
