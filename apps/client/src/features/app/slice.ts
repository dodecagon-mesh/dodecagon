import {
  normalizeShortcutOverrides,
  type TShortcutOverrides
} from '@/components/hotkeys-controller/shortcuts';
import {
  getLocalStorageItemAsJSON,
  getLocalStorageItemAsNumber,
  getLocalStorageItemBool,
  LocalStorageKey,
  setLocalStorageItemBool
} from '@/helpers/storage';
import type { TMessageJumpToTarget } from '@/types';
import { castDraft, produce } from 'immer';

export interface TAppState {
  appLoading: boolean;
  isAutoConnecting: boolean;
  loadingPlugins: boolean;
  modViewOpen: boolean;
  modViewUserId: number | undefined;
  threadSidebarOpen: boolean;
  threadParentMessageId: number | undefined;
  threadChannelId: number | undefined;
  autoJoinLastChannel: boolean;
  selectedDmChannelId: number | undefined;
  browserNotifications: boolean;
  browserNotificationsForMentions: boolean;
  browserNotificationsForDms: boolean;
  browserNotificationsForReplies: boolean;
  notificationSounds: boolean;
  messageSentSound: boolean;
  joinLeaveSounds: boolean;
  muteDeafenSounds: boolean;
  mutedChannelIds: number[];
  messageJumpTarget: TMessageJumpToTarget | undefined;
  voiceChatSidebarOpen: boolean;
  voiceChatChannelId: number | undefined;
  membersPanelOpen: boolean;
  pluginSlotDebug: boolean;
  modifierKeysHeldMap: Record<string, boolean>;
  shortcutOverrides: TShortcutOverrides;
}

const initialState: TAppState = {
  appLoading: true,
  isAutoConnecting: false,
  loadingPlugins: true,
  modViewOpen: false,
  modViewUserId: undefined,
  threadSidebarOpen: false,
  threadParentMessageId: undefined,
  threadChannelId: undefined,
  autoJoinLastChannel: false,
  selectedDmChannelId: undefined,
  browserNotifications: false,
  browserNotificationsForMentions: false,
  browserNotificationsForDms: false,
  browserNotificationsForReplies: false,
  notificationSounds: true,
  messageSentSound: true,
  joinLeaveSounds: true,
  muteDeafenSounds: true,
  mutedChannelIds: [],
  messageJumpTarget: undefined,
  voiceChatSidebarOpen: false,
  voiceChatChannelId: undefined,
  membersPanelOpen: false,
  pluginSlotDebug: false,
  shortcutOverrides: {},
  modifierKeysHeldMap: { Shift: false, Control: false, Alt: false }
};

interface TAppStorageFlags {
  autoJoinLastChannel: boolean;
  browserNotifications: boolean;
  browserNotificationsForMentions: boolean;
  browserNotificationsForDms: boolean;
  browserNotificationsForReplies: boolean;
  notificationSounds: boolean;
  messageSentSound: boolean;
  joinLeaveSounds: boolean;
  muteDeafenSounds: boolean;
  mutedChannelIds: number[];
  voiceChatSidebarOpen: boolean;
  voiceChatChannelId: number | undefined;
  membersPanelOpen: boolean;
  pluginSlotDebug: boolean;
  shortcutOverrides: TShortcutOverrides;
}

// the storage only exists in the browser and the first render has to look the
// same on the server, so the client hydrates the flags after the render
export const hydrateAppFromStorage = (): {
  type: 'app/hydrateFromStorage';
  payload: TAppStorageFlags;
} => {
  const voiceChatSidebarOpen = getLocalStorageItemBool(
    LocalStorageKey.VOICE_CHAT_SIDEBAR_STATE,
    false
  );
  const membersPanelOpen = getLocalStorageItemBool(
    LocalStorageKey.RIGHT_SIDEBAR_STATE,
    true
  );

  // only one dock can be open on the right, the voice chat that was open
  // before the reload replaces the members panel, the stored preference has to
  // follow so that the panels never come back together
  if (voiceChatSidebarOpen && membersPanelOpen) {
    setLocalStorageItemBool(LocalStorageKey.RIGHT_SIDEBAR_STATE, false);
  }

  return {
    type: 'app/hydrateFromStorage',
    payload: {
      autoJoinLastChannel: getLocalStorageItemBool(
        LocalStorageKey.AUTO_JOIN_LAST_CHANNEL,
        false
      ),
      browserNotifications: getLocalStorageItemBool(
        LocalStorageKey.BROWSER_NOTIFICATIONS,
        false
      ),
      browserNotificationsForMentions: getLocalStorageItemBool(
        LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_MENTIONS,
        false
      ),
      browserNotificationsForDms: getLocalStorageItemBool(
        LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_DMS,
        false
      ),
      browserNotificationsForReplies: getLocalStorageItemBool(
        LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_REPLIES,
        false
      ),
      notificationSounds: getLocalStorageItemBool(
        LocalStorageKey.NOTIFICATION_SOUNDS,
        true
      ),
      messageSentSound: getLocalStorageItemBool(
        LocalStorageKey.MESSAGE_SENT_SOUND,
        true
      ),
      joinLeaveSounds: getLocalStorageItemBool(
        LocalStorageKey.JOIN_LEAVE_SOUNDS,
        true
      ),
      muteDeafenSounds: getLocalStorageItemBool(
        LocalStorageKey.MUTE_DEAFEN_SOUNDS,
        true
      ),
      mutedChannelIds:
        getLocalStorageItemAsJSON<number[]>(
          LocalStorageKey.MUTED_CHANNEL_IDS
        ) ?? [],
      voiceChatSidebarOpen,
      voiceChatChannelId: getLocalStorageItemAsNumber(
        LocalStorageKey.VOICE_CHAT_SIDEBAR_CHANNEL_ID
      ),
      membersPanelOpen: voiceChatSidebarOpen ? false : membersPanelOpen,
      pluginSlotDebug: getLocalStorageItemBool(
        LocalStorageKey.PLUGIN_SLOT_DEBUG,
        false
      ),
      shortcutOverrides: normalizeShortcutOverrides(
        getLocalStorageItemAsJSON<unknown>(LocalStorageKey.SHORTCUT_OVERRIDES)
      )
    }
  };
};

const appSliceActions = {
  setAppLoading: (payload: boolean) =>
    ({ type: 'app/setAppLoading', payload }) as const,
  setLoadingPlugins: (payload: boolean) =>
    ({ type: 'app/setLoadingPlugins', payload }) as const,
  setModViewOpen: (payload: { modViewOpen: boolean; userId?: number }) =>
    ({ type: 'app/setModViewOpen', payload }) as const,
  setThreadSidebarOpen: (payload: {
    open: boolean;
    parentMessageId?: number;
    channelId?: number;
  }) => ({ type: 'app/setThreadSidebarOpen', payload }) as const,
  setAutoJoinLastChannel: (payload: boolean) =>
    ({ type: 'app/setAutoJoinLastChannel', payload }) as const,
  setIsAutoConnecting: (payload: boolean) =>
    ({ type: 'app/setIsAutoConnecting', payload }) as const,
  setSelectedDmChannelId: (payload: number | undefined) =>
    ({ type: 'app/setSelectedDmChannelId', payload }) as const,
  setBrowserNotifications: (payload: boolean) =>
    ({ type: 'app/setBrowserNotifications', payload }) as const,
  setBrowserNotificationsForMentions: (payload: boolean) =>
    ({ type: 'app/setBrowserNotificationsForMentions', payload }) as const,
  setBrowserNotificationsForDms: (payload: boolean) =>
    ({ type: 'app/setBrowserNotificationsForDms', payload }) as const,
  setBrowserNotificationsForReplies: (payload: boolean) =>
    ({ type: 'app/setBrowserNotificationsForReplies', payload }) as const,
  setNotificationSounds: (payload: boolean) =>
    ({ type: 'app/setNotificationSounds', payload }) as const,
  setMessageSentSound: (payload: boolean) =>
    ({ type: 'app/setMessageSentSound', payload }) as const,
  setJoinLeaveSounds: (payload: boolean) =>
    ({ type: 'app/setJoinLeaveSounds', payload }) as const,
  setMuteDeafenSounds: (payload: boolean) =>
    ({ type: 'app/setMuteDeafenSounds', payload }) as const,
  setMutedChannelIds: (payload: number[]) =>
    ({ type: 'app/setMutedChannelIds', payload }) as const,
  setMessageJumpTarget: (payload: TMessageJumpToTarget | undefined) =>
    ({ type: 'app/setMessageJumpTarget', payload }) as const,
  setVoiceChatSidebar: (payload: { open: boolean; channelId?: number }) =>
    ({ type: 'app/setVoiceChatSidebar', payload }) as const,
  setMembersPanelOpen: (payload: boolean) =>
    ({ type: 'app/setMembersPanelOpen', payload }) as const,
  setPluginSlotDebug: (payload: boolean) =>
    ({ type: 'app/setPluginSlotDebug', payload }) as const,
  setShortcutOverrides: (payload: TShortcutOverrides) =>
    ({ type: 'app/setShortcutOverrides', payload }) as const,
  setModifierKeysHeldMap: (payload: Record<string, boolean>) =>
    ({ type: 'app/setModifierKeysHeldMap', payload }) as const
};

export type TAppAction =
  | ReturnType<(typeof appSliceActions)[keyof typeof appSliceActions]>
  | ReturnType<typeof hydrateAppFromStorage>;

const appSliceReducer = (state: TAppState, action: TAppAction): TAppState =>
  produce(state, (draft) => {
    switch (action.type) {
      case 'app/hydrateFromStorage': {
        draft.autoJoinLastChannel = action.payload.autoJoinLastChannel;
        draft.browserNotifications = action.payload.browserNotifications;
        draft.browserNotificationsForMentions =
          action.payload.browserNotificationsForMentions;
        draft.browserNotificationsForDms =
          action.payload.browserNotificationsForDms;
        draft.browserNotificationsForReplies =
          action.payload.browserNotificationsForReplies;
        draft.notificationSounds = action.payload.notificationSounds;
        draft.messageSentSound = action.payload.messageSentSound;
        draft.joinLeaveSounds = action.payload.joinLeaveSounds;
        draft.muteDeafenSounds = action.payload.muteDeafenSounds;
        draft.mutedChannelIds = action.payload.mutedChannelIds;
        draft.voiceChatSidebarOpen = action.payload.voiceChatSidebarOpen;
        draft.voiceChatChannelId = action.payload.voiceChatChannelId;
        draft.membersPanelOpen = action.payload.membersPanelOpen;
        draft.pluginSlotDebug = action.payload.pluginSlotDebug;
        draft.shortcutOverrides = castDraft(action.payload.shortcutOverrides);

        // only one dock can be open on the right, the thread and the voice
        // chat replace the members panel, the thread replaces the voice chat
        if (draft.threadSidebarOpen) {
          draft.voiceChatSidebarOpen = false;
          draft.membersPanelOpen = false;
        } else if (draft.voiceChatSidebarOpen) {
          draft.membersPanelOpen = false;
        }
        break;
      }
      case 'app/setAppLoading':
        draft.appLoading = action.payload;
        break;
      case 'app/setLoadingPlugins':
        draft.loadingPlugins = action.payload;
        break;
      case 'app/setModViewOpen':
        draft.modViewOpen = action.payload.modViewOpen;
        draft.modViewUserId = action.payload.userId;
        break;
      case 'app/setThreadSidebarOpen':
        draft.threadSidebarOpen = action.payload.open;
        draft.threadParentMessageId = action.payload.parentMessageId;
        draft.threadChannelId = action.payload.channelId;

        // only one dock can be open on the right, the thread replaces the
        // voice chat and the members panel
        if (action.payload.open) {
          draft.voiceChatSidebarOpen = false;
          draft.membersPanelOpen = false;
        }
        break;
      case 'app/setAutoJoinLastChannel':
        draft.autoJoinLastChannel = action.payload;
        break;
      case 'app/setIsAutoConnecting':
        draft.isAutoConnecting = action.payload;
        break;
      case 'app/setSelectedDmChannelId':
        draft.selectedDmChannelId = action.payload;
        break;
      case 'app/setBrowserNotifications':
        draft.browserNotifications = action.payload;
        break;
      case 'app/setBrowserNotificationsForMentions':
        draft.browserNotificationsForMentions = action.payload;
        break;
      case 'app/setBrowserNotificationsForDms':
        draft.browserNotificationsForDms = action.payload;
        break;
      case 'app/setBrowserNotificationsForReplies':
        draft.browserNotificationsForReplies = action.payload;
        break;
      case 'app/setNotificationSounds':
        draft.notificationSounds = action.payload;
        break;
      case 'app/setMessageSentSound':
        draft.messageSentSound = action.payload;
        break;
      case 'app/setJoinLeaveSounds':
        draft.joinLeaveSounds = action.payload;
        break;
      case 'app/setMuteDeafenSounds':
        draft.muteDeafenSounds = action.payload;
        break;
      case 'app/setMutedChannelIds':
        draft.mutedChannelIds = action.payload;
        break;
      case 'app/setMessageJumpTarget':
        draft.messageJumpTarget = action.payload;
        break;
      case 'app/setVoiceChatSidebar':
        draft.voiceChatSidebarOpen = action.payload.open;
        draft.voiceChatChannelId = action.payload.channelId;

        // only one dock can be open on the right, the voice chat replaces the
        // thread and the members panel
        if (action.payload.open) {
          draft.threadSidebarOpen = false;
          draft.threadParentMessageId = undefined;
          draft.threadChannelId = undefined;
          draft.membersPanelOpen = false;
        }
        break;
      case 'app/setMembersPanelOpen':
        draft.membersPanelOpen = action.payload;

        // only one dock can be open on the right, the members panel replaces
        // the thread and the voice chat
        if (action.payload) {
          draft.threadSidebarOpen = false;
          draft.threadParentMessageId = undefined;
          draft.threadChannelId = undefined;
          draft.voiceChatSidebarOpen = false;
        }
        break;
      case 'app/setPluginSlotDebug':
        draft.pluginSlotDebug = action.payload;
        break;
      case 'app/setShortcutOverrides':
        draft.shortcutOverrides = castDraft(
          normalizeShortcutOverrides(action.payload)
        );
        break;
      case 'app/setModifierKeysHeldMap':
        draft.modifierKeysHeldMap = action.payload;
        break;
    }
  });

export { initialState as appInitialState, appSliceActions, appSliceReducer };
