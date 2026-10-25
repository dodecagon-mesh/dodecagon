import type { TPinnedCard } from '@/components/channel-view/voice/hooks/use-pin-card-controller';
import { getLocalStorageItemBool, LocalStorageKey } from '@/helpers/storage';
import type {
  TCategory,
  TChannel,
  TChannelUserPermissionsMap,
  TCommandsMapByPlugin,
  TExternalStream,
  TExternalStreamsMap,
  TJoinedEmoji,
  TJoinedPublicUser,
  TJoinedRole,
  TPluginCapabilityAccessRule,
  TPluginComponentsMap,
  TPluginMetadata,
  TPluginTab,
  TPluginTabsMap,
  TPublicServerSettings,
  TReadStateMap,
  TScreenViewersSnapshot,
  TServerInfo,
  TServerUpdateState,
  TVoiceMap,
  TVoiceUserState
} from '@dodecagon/shared';
import { produce } from 'immer';
import type { TDisconnectInfo, TReconnectState, TVoiceReaction } from './types';
import { MAX_VOICE_REACTIONS_PER_USER } from './voice/statics';

export interface IServerState {
  connected: boolean;
  connecting: boolean;
  reconnect: TReconnectState | null;
  updateState: TServerUpdateState;
  updateRequested: boolean;
  disconnectInfo?: TDisconnectInfo;
  serverId?: string;
  categories: TCategory[];
  channels: TChannel[];
  emojis: TJoinedEmoji[];
  ownUserId: number | undefined;
  ownUserPasswordSet: boolean;
  selectedChannelId: number | undefined;
  currentVoiceChannelId: number | undefined;
  // it lives here rather than in the subscription because joining the new room needs the voice provider context
  voiceMoveTargetChannelId: number | undefined;
  users: TJoinedPublicUser[];
  roles: TJoinedRole[];
  publicSettings: TPublicServerSettings | undefined;
  info: TServerInfo | undefined;
  loadingInfo: boolean;
  typingMap: {
    [channelId: number]: number[];
  };
  threadTypingMap: {
    [parentMessageId: number]: number[];
  };
  voiceMap: TVoiceMap;
  voiceReactions: {
    [userId: number]: TVoiceReaction[];
  };
  externalStreamsMap: TExternalStreamsMap;
  screenViewersMap: {
    [channelId: number]: TScreenViewersSnapshot['demos'];
  };
  ownVoiceState: TVoiceUserState;
  pinnedCard: TPinnedCard | undefined;
  channelPermissions: TChannelUserPermissionsMap;
  readStatesMap: {
    [channelId: number]: number | undefined;
  };
  pluginsMetadata: TPluginMetadata[];
  pluginCommands: TCommandsMapByPlugin;
  hideNonVideoParticipants: boolean;
  showUserBannersInVoice: boolean;
  hideOwnScreenShare: boolean;
  pluginComponents: TPluginComponentsMap;
  pluginTabs: TPluginTabsMap;
  pluginCapabilityAccess: TPluginCapabilityAccessRule[];
  activeFullscreenPluginId: string | undefined;
  dmsOpen: boolean;
}

const initialState: IServerState = {
  connected: false,
  connecting: false,
  reconnect: null,
  updateState: null,
  updateRequested: false,
  disconnectInfo: undefined,
  serverId: undefined,
  ownUserId: undefined,
  ownUserPasswordSet: true,
  categories: [],
  channels: [],
  emojis: [],
  selectedChannelId: undefined,
  currentVoiceChannelId: undefined,
  voiceMoveTargetChannelId: undefined,
  users: [],
  roles: [],
  publicSettings: undefined,
  info: undefined,
  loadingInfo: false,
  typingMap: {},
  threadTypingMap: {},
  voiceMap: {},
  voiceReactions: {},
  externalStreamsMap: {},
  screenViewersMap: {},
  ownVoiceState: {
    micMuted: false,
    soundMuted: false,
    webcamEnabled: false,
    sharingScreen: false
  },
  pinnedCard: undefined,
  channelPermissions: {},
  readStatesMap: {},
  pluginsMetadata: [],
  pluginCommands: {},
  hideNonVideoParticipants: false,
  showUserBannersInVoice: true,
  pluginComponents: {},
  pluginTabs: {},
  pluginCapabilityAccess: [],
  activeFullscreenPluginId: undefined,
  dmsOpen: false,
  hideOwnScreenShare: false
};

interface TServerStorageFlags {
  hideNonVideoParticipants: boolean;
  showUserBannersInVoice: boolean;
  hideOwnScreenShare: boolean;
}

// the storage only exists in the browser and the first render has to look the
// same on the server, so the client hydrates the flags after the render
export const hydrateServerFromStorage = (): {
  type: 'server/hydrateFromStorage';
  payload: TServerStorageFlags;
} => ({
  type: 'server/hydrateFromStorage',
  payload: {
    hideNonVideoParticipants: getLocalStorageItemBool(
      LocalStorageKey.HIDE_NON_VIDEO_PARTICIPANTS,
      false
    ),
    showUserBannersInVoice: getLocalStorageItemBool(
      LocalStorageKey.VOICE_CHAT_SHOW_USER_BANNERS,
      true
    ),
    hideOwnScreenShare: getLocalStorageItemBool(
      LocalStorageKey.HIDE_OWN_SCREEN_SHARE,
      false
    )
  }
});

const serverSliceActions = {
  resetState: () => ({ type: 'server/resetState' }) as const,
  setConnected: (payload: boolean) =>
    ({ type: 'server/setConnected', payload }) as const,
  setReconnect: (payload: TReconnectState | null) =>
    ({ type: 'server/setReconnect', payload }) as const,
  setUpdateState: (payload: TServerUpdateState) =>
    ({ type: 'server/setUpdateState', payload }) as const,
  setUpdateRequested: (payload: boolean) =>
    ({ type: 'server/setUpdateRequested', payload }) as const,
  setInfo: (payload: TServerInfo | undefined) =>
    ({ type: 'server/setInfo', payload }) as const,
  setLoadingInfo: (payload: boolean) =>
    ({ type: 'server/setLoadingInfo', payload }) as const,
  setDisconnectInfo: (payload: TDisconnectInfo | undefined) =>
    ({ type: 'server/setDisconnectInfo', payload }) as const,
  setInitialData: (payload: {
    serverId: string;
    categories: TCategory[];
    channels: TChannel[];
    users: TJoinedPublicUser[];
    ownUserId: number;
    ownUserPasswordSet: boolean;
    roles: TJoinedRole[];
    emojis: TJoinedEmoji[];
    publicSettings: TPublicServerSettings | undefined;
    voiceMap: TVoiceMap;
    externalStreamsMap: TExternalStreamsMap;
    channelPermissions: TChannelUserPermissionsMap;
    readStates: TReadStateMap;
    pluginsMetadata: TPluginMetadata[];
  }) => ({ type: 'server/setInitialData', payload }) as const,
  clearTypingUsers: (payload: number) =>
    ({ type: 'server/clearTypingUsers', payload }) as const,
  addTypingUser: (payload: { channelId: number; userId: number }) =>
    ({ type: 'server/addTypingUser', payload }) as const,
  removeTypingUser: (payload: { channelId: number; userId: number }) =>
    ({ type: 'server/removeTypingUser', payload }) as const,
  addThreadTypingUser: (payload: { parentMessageId: number; userId: number }) =>
    ({ type: 'server/addThreadTypingUser', payload }) as const,
  removeThreadTypingUser: (payload: {
    parentMessageId: number;
    userId: number;
  }) => ({ type: 'server/removeThreadTypingUser', payload }) as const,
  updateUser: (payload: { userId: number; user: Partial<TJoinedPublicUser> }) =>
    ({ type: 'server/updateUser', payload }) as const,
  addUser: (payload: TJoinedPublicUser) =>
    ({ type: 'server/addUser', payload }) as const,
  wipeUser: (payload: { userId: number }) =>
    ({ type: 'server/wipeUser', payload }) as const,
  reassignUser: (payload: { userId: number; deletedUserId: number }) =>
    ({ type: 'server/reassignUser', payload }) as const,
  setPublicSettings: (payload: TPublicServerSettings | undefined) =>
    ({ type: 'server/setPublicSettings', payload }) as const,
  updateRole: (payload: { roleId: number; role: Partial<TJoinedRole> }) =>
    ({ type: 'server/updateRole', payload }) as const,
  addRole: (payload: TJoinedRole) =>
    ({ type: 'server/addRole', payload }) as const,
  removeRole: (payload: { roleId: number }) =>
    ({ type: 'server/removeRole', payload }) as const,
  updateChannel: (payload: { channelId: number; channel: Partial<TChannel> }) =>
    ({ type: 'server/updateChannel', payload }) as const,
  addChannel: (payload: TChannel) =>
    ({ type: 'server/addChannel', payload }) as const,
  removeChannel: (payload: { channelId: number }) =>
    ({ type: 'server/removeChannel', payload }) as const,
  setSelectedChannelId: (payload: number | undefined) =>
    ({ type: 'server/setSelectedChannelId', payload }) as const,
  setCurrentVoiceChannelId: (payload: number | undefined) =>
    ({ type: 'server/setCurrentVoiceChannelId', payload }) as const,
  setVoiceMoveTargetChannelId: (payload: number | undefined) =>
    ({ type: 'server/setVoiceMoveTargetChannelId', payload }) as const,
  setChannelPermissions: (payload: TChannelUserPermissionsMap) =>
    ({ type: 'server/setChannelPermissions', payload }) as const,
  setChannelReadState: (payload: {
    channelId: number;
    count: number | undefined;
  }) => ({ type: 'server/setChannelReadState', payload }) as const,
  updateEmoji: (payload: { emojiId: number; emoji: Partial<TJoinedEmoji> }) =>
    ({ type: 'server/updateEmoji', payload }) as const,
  addEmoji: (payload: TJoinedEmoji) =>
    ({ type: 'server/addEmoji', payload }) as const,
  removeEmoji: (payload: { emojiId: number }) =>
    ({ type: 'server/removeEmoji', payload }) as const,
  addCategory: (payload: TCategory) =>
    ({ type: 'server/addCategory', payload }) as const,
  updateCategory: (payload: {
    categoryId: number;
    category: Partial<TCategory>;
  }) => ({ type: 'server/updateCategory', payload }) as const,
  removeCategory: (payload: { categoryId: number }) =>
    ({ type: 'server/removeCategory', payload }) as const,
  addUserToVoiceChannel: (payload: {
    channelId: number;
    userId: number;
    state: TVoiceUserState;
  }) => ({ type: 'server/addUserToVoiceChannel', payload }) as const,
  removeUserFromVoiceChannel: (payload: {
    channelId: number;
    userId: number;
  }) => ({ type: 'server/removeUserFromVoiceChannel', payload }) as const,
  updateVoiceUserState: (payload: {
    channelId: number;
    userId: number;
    newState: Partial<TVoiceUserState>;
  }) => ({ type: 'server/updateVoiceUserState', payload }) as const,
  addVoiceReaction: (payload: { userId: number; reaction: TVoiceReaction }) =>
    ({ type: 'server/addVoiceReaction', payload }) as const,
  removeVoiceReaction: (payload: { userId: number; reactionId: number }) =>
    ({ type: 'server/removeVoiceReaction', payload }) as const,
  updateOwnVoiceState: (payload: Partial<TVoiceUserState>) =>
    ({ type: 'server/updateOwnVoiceState', payload }) as const,
  setPinnedCard: (payload: TPinnedCard | undefined) =>
    ({ type: 'server/setPinnedCard', payload }) as const,
  setScreenViewers: (payload: TScreenViewersSnapshot) =>
    ({ type: 'server/setScreenViewers', payload }) as const,
  setHideNonVideoParticipants: (payload: boolean) =>
    ({ type: 'server/setHideNonVideoParticipants', payload }) as const,
  setShowUserBannersInVoice: (payload: boolean) =>
    ({ type: 'server/setShowUserBannersInVoice', payload }) as const,
  setHideOwnScreenShare: (payload: boolean) =>
    ({ type: 'server/setHideOwnScreenShare', payload }) as const,
  addExternalStreamToChannel: (payload: {
    channelId: number;
    streamId: number;
    stream: TExternalStream;
  }) => ({ type: 'server/addExternalStreamToChannel', payload }) as const,
  updateExternalStreamInChannel: (payload: {
    channelId: number;
    streamId: number;
    stream: TExternalStream;
  }) => ({ type: 'server/updateExternalStreamInChannel', payload }) as const,
  removeExternalStreamFromChannel: (payload: {
    channelId: number;
    streamId: number;
  }) => ({ type: 'server/removeExternalStreamFromChannel', payload }) as const,
  setPluginsMetadata: (payload: TPluginMetadata[]) =>
    ({ type: 'server/setPluginsMetadata', payload }) as const,
  setPluginCommands: (payload: TCommandsMapByPlugin) =>
    ({ type: 'server/setPluginCommands', payload }) as const,
  setPluginCapabilityAccess: (payload: TPluginCapabilityAccessRule[]) =>
    ({ type: 'server/setPluginCapabilityAccess', payload }) as const,
  setPluginTabs: (payload: TPluginTabsMap) =>
    ({ type: 'server/setPluginTabs', payload }) as const,
  setPluginTabsForPlugin: (payload: { pluginId: string; tabs: TPluginTab[] }) =>
    ({ type: 'server/setPluginTabsForPlugin', payload }) as const,
  setPluginComponents: (payload: TPluginComponentsMap) =>
    ({ type: 'server/setPluginComponents', payload }) as const,
  setActiveFullscreenPluginId: (payload: string | undefined) =>
    ({ type: 'server/setActiveFullscreenPluginId', payload }) as const,
  setDmsOpen: (payload: boolean) =>
    ({ type: 'server/setDmsOpen', payload }) as const
};

export type TServerAction =
  | ReturnType<(typeof serverSliceActions)[keyof typeof serverSliceActions]>
  | ReturnType<typeof hydrateServerFromStorage>;

const serverSliceReducer = (
  state: IServerState,
  action: TServerAction
): IServerState =>
  produce(state, (draft) => {
    switch (action.type) {
      case 'server/resetState': {
        // the flags come from the storage of the user, a reset of the
        // connection state must not drop them
        Object.assign(draft, {
          ...initialState,
          info: draft.info,
          hideNonVideoParticipants: draft.hideNonVideoParticipants,
          showUserBannersInVoice: draft.showUserBannersInVoice,
          hideOwnScreenShare: draft.hideOwnScreenShare
        });
        break;
      }
      case 'server/hydrateFromStorage': {
        draft.hideNonVideoParticipants =
          action.payload.hideNonVideoParticipants;
        draft.showUserBannersInVoice = action.payload.showUserBannersInVoice;
        draft.hideOwnScreenShare = action.payload.hideOwnScreenShare;
        break;
      }
      case 'server/setConnected': {
        draft.connected = action.payload;
        draft.connecting = false;
        if (!action.payload) {
          // A recovered account session is not permission to restart media capture.
          draft.currentVoiceChannelId = undefined;
          draft.voiceMoveTargetChannelId = undefined;
          draft.ownVoiceState = initialState.ownVoiceState;
          draft.pinnedCard = undefined;
        }
        break;
      }
      case 'server/setReconnect': {
        draft.reconnect = action.payload;
        break;
      }
      case 'server/setUpdateState': {
        draft.updateState = action.payload;
        draft.updateRequested = false;
        break;
      }
      case 'server/setUpdateRequested': {
        draft.updateRequested = action.payload;
        break;
      }
      case 'server/setInfo': {
        draft.info = action.payload;
        break;
      }
      case 'server/setLoadingInfo': {
        draft.loadingInfo = action.payload;
        break;
      }
      case 'server/setDisconnectInfo': {
        draft.disconnectInfo = action.payload;
        break;
      }
      case 'server/setInitialData': {
        draft.connected = true;
        draft.reconnect = null;
        draft.categories = action.payload.categories;
        draft.channels = action.payload.channels;
        draft.emojis = action.payload.emojis;
        draft.users = action.payload.users;
        draft.roles = action.payload.roles;
        draft.ownUserId = action.payload.ownUserId;
        draft.ownUserPasswordSet = action.payload.ownUserPasswordSet;
        draft.publicSettings = action.payload.publicSettings;
        draft.voiceMap = action.payload.voiceMap;
        draft.externalStreamsMap = action.payload.externalStreamsMap;
        draft.serverId = action.payload.serverId;
        draft.channelPermissions = action.payload.channelPermissions;
        draft.readStatesMap = action.payload.readStates;
        draft.pluginsMetadata = action.payload.pluginsMetadata;
        break;
      }
      case 'server/clearTypingUsers': {
        delete draft.typingMap[action.payload];
        break;
      }
      case 'server/addTypingUser': {
        const { channelId, userId } = action.payload;
        const typingUsers = draft.typingMap[channelId] || [];

        if (!typingUsers.includes(userId)) {
          typingUsers.push(userId);
          draft.typingMap[channelId] = typingUsers;
        }
        break;
      }
      case 'server/removeTypingUser': {
        const { channelId, userId } = action.payload;
        const typingUsers = draft.typingMap[channelId] || [];

        draft.typingMap[channelId] = typingUsers.filter((id) => id !== userId);
        break;
      }
      case 'server/addThreadTypingUser': {
        const { parentMessageId, userId } = action.payload;
        const typingUsers = draft.threadTypingMap[parentMessageId] || [];

        if (!typingUsers.includes(userId)) {
          typingUsers.push(userId);
          draft.threadTypingMap[parentMessageId] = typingUsers;
        }
        break;
      }
      case 'server/removeThreadTypingUser': {
        const { parentMessageId, userId } = action.payload;
        const typingUsers = draft.threadTypingMap[parentMessageId] || [];

        draft.threadTypingMap[parentMessageId] = typingUsers.filter(
          (id) => id !== userId
        );
        break;
      }
      case 'server/updateUser': {
        const index = draft.users.findIndex(
          (u) => u.id === action.payload.userId
        );

        if (index === -1) return;

        draft.users[index] = {
          ...draft.users[index],
          ...action.payload.user
        };
        break;
      }
      case 'server/addUser': {
        const exists = draft.users.find((u) => u.id === action.payload.id);

        if (exists) return;

        draft.users.push(action.payload);
        break;
      }
      case 'server/wipeUser': {
        const { userId } = action.payload;

        // remove user
        draft.users = draft.users.filter((u) => u.id !== userId);

        // remove user from typing states
        for (const channelId in draft.typingMap) {
          draft.typingMap[channelId] = draft.typingMap[channelId].filter(
            (id) => id !== userId
          );
        }

        // remove user from voice channels
        for (const channelId in draft.voiceMap) {
          delete draft.voiceMap[channelId].users[userId];
        }

        // remove user from emojis
        draft.emojis = draft.emojis.filter((e) => e.userId !== userId);
        break;
      }
      case 'server/reassignUser': {
        const { userId, deletedUserId } = action.payload;

        // remove user
        draft.users = draft.users.filter((u) => u.id !== userId);

        // remove user from typing states
        for (const channelId in draft.typingMap) {
          draft.typingMap[channelId] = draft.typingMap[channelId].filter(
            (id) => id !== userId
          );
        }

        // remove user from voice channels
        for (const channelId in draft.voiceMap) {
          delete draft.voiceMap[channelId].users[userId];
        }

        // reassign emojis
        draft.emojis = draft.emojis.map((e) =>
          e.userId === userId ? { ...e, userId: deletedUserId } : e
        );
        break;
      }
      case 'server/setPublicSettings': {
        draft.publicSettings = action.payload;
        break;
      }
      case 'server/updateRole': {
        const index = draft.roles.findIndex(
          (r) => r.id === action.payload.roleId
        );

        if (index === -1) return;

        draft.roles[index] = {
          ...draft.roles[index],
          ...action.payload.role
        };
        break;
      }
      case 'server/addRole': {
        const exists = draft.roles.find((r) => r.id === action.payload.id);

        if (exists) return;

        draft.roles.push(action.payload);
        break;
      }
      case 'server/removeRole': {
        draft.roles = draft.roles.filter((r) => r.id !== action.payload.roleId);
        break;
      }
      case 'server/updateChannel': {
        const index = draft.channels.findIndex(
          (c) => c.id === action.payload.channelId
        );

        if (index === -1) return;

        draft.channels[index] = {
          ...draft.channels[index],
          ...action.payload.channel
        };
        break;
      }
      case 'server/addChannel': {
        const exists = draft.channels.find((c) => c.id === action.payload.id);

        if (exists) return;

        draft.channels.push(action.payload);
        break;
      }
      case 'server/removeChannel': {
        draft.channels = draft.channels.filter(
          (c) => c.id !== action.payload.channelId
        );
        break;
      }
      case 'server/setSelectedChannelId': {
        draft.selectedChannelId = action.payload;

        if (action.payload) {
          draft.activeFullscreenPluginId = undefined;
        }
        break;
      }
      case 'server/setCurrentVoiceChannelId': {
        draft.currentVoiceChannelId = action.payload;
        break;
      }
      case 'server/setVoiceMoveTargetChannelId': {
        draft.voiceMoveTargetChannelId = action.payload;
        break;
      }
      case 'server/setChannelPermissions': {
        draft.channelPermissions = action.payload;
        break;
      }
      case 'server/setChannelReadState': {
        const { channelId, count } = action.payload;

        draft.readStatesMap[channelId] = count;
        break;
      }
      case 'server/updateEmoji': {
        const index = draft.emojis.findIndex(
          (e) => e.id === action.payload.emojiId
        );
        if (index === -1) return;
        draft.emojis[index] = {
          ...draft.emojis[index],
          ...action.payload.emoji
        };
        break;
      }
      case 'server/addEmoji': {
        const exists = draft.emojis.find((e) => e.id === action.payload.id);

        if (exists) return;
        draft.emojis.push(action.payload);
        break;
      }
      case 'server/removeEmoji': {
        draft.emojis = draft.emojis.filter(
          (e) => e.id !== action.payload.emojiId
        );
        break;
      }
      case 'server/addCategory': {
        const exists = draft.categories.find((c) => c.id === action.payload.id);

        if (exists) return;

        draft.categories.push(action.payload);
        break;
      }
      case 'server/updateCategory': {
        const index = draft.categories.findIndex(
          (c) => c.id === action.payload.categoryId
        );

        if (index === -1) return;

        draft.categories[index] = {
          ...draft.categories[index],
          ...action.payload.category
        };
        break;
      }
      case 'server/removeCategory': {
        draft.categories = draft.categories.filter(
          (c) => c.id !== action.payload.categoryId
        );
        break;
      }
      case 'server/addUserToVoiceChannel': {
        const { channelId, userId, state: userState } = action.payload;

        if (!draft.voiceMap[channelId]) {
          draft.voiceMap[channelId] = { users: {} };
        }

        draft.voiceMap[channelId].users[userId] = userState;
        break;
      }
      case 'server/removeUserFromVoiceChannel': {
        const { channelId, userId } = action.payload;

        if (!draft.voiceMap[channelId]) return;

        delete draft.voiceMap[channelId].users[userId];
        break;
      }
      case 'server/updateVoiceUserState': {
        const { channelId, userId, newState } = action.payload;

        if (!draft.voiceMap[channelId]) return;
        if (!draft.voiceMap[channelId].users[userId]) return;

        draft.voiceMap[channelId].users[userId] = {
          ...draft.voiceMap[channelId].users[userId],
          ...newState
        };
        break;
      }
      case 'server/addVoiceReaction': {
        const { userId, reaction } = action.payload;
        const reactions = draft.voiceReactions[userId];

        if (!reactions) {
          draft.voiceReactions[userId] = [reaction];

          return;
        }

        reactions.push(reaction);

        if (reactions.length > MAX_VOICE_REACTIONS_PER_USER) reactions.shift();
        break;
      }
      case 'server/removeVoiceReaction': {
        const { userId, reactionId } = action.payload;
        const reactions = draft.voiceReactions[userId];

        if (!reactions) return;

        const remaining = reactions.filter(({ id }) => id !== reactionId);

        if (!remaining.length) {
          delete draft.voiceReactions[userId];

          return;
        }

        draft.voiceReactions[userId] = remaining;
        break;
      }
      case 'server/updateOwnVoiceState': {
        draft.ownVoiceState = {
          ...draft.ownVoiceState,
          ...action.payload
        };
        break;
      }
      case 'server/setPinnedCard': {
        draft.pinnedCard = action.payload;
        break;
      }
      case 'server/setScreenViewers': {
        draft.screenViewersMap[action.payload.channelId] = action.payload.demos;
        break;
      }
      case 'server/setHideNonVideoParticipants': {
        draft.hideNonVideoParticipants = action.payload;
        break;
      }
      case 'server/setShowUserBannersInVoice': {
        draft.showUserBannersInVoice = action.payload;
        break;
      }
      case 'server/setHideOwnScreenShare': {
        draft.hideOwnScreenShare = action.payload;
        break;
      }
      case 'server/addExternalStreamToChannel': {
        const { channelId, streamId, stream } = action.payload;

        if (!draft.externalStreamsMap[channelId]) {
          draft.externalStreamsMap[channelId] = {};
        }

        draft.externalStreamsMap[channelId][streamId] = stream;
        break;
      }
      case 'server/updateExternalStreamInChannel': {
        const { channelId, streamId, stream } = action.payload;

        if (!draft.externalStreamsMap[channelId]) return;
        if (!draft.externalStreamsMap[channelId][streamId]) return;

        draft.externalStreamsMap[channelId][streamId] = stream;
        break;
      }
      case 'server/removeExternalStreamFromChannel': {
        const { channelId, streamId } = action.payload;

        if (!draft.externalStreamsMap[channelId]) return;

        delete draft.externalStreamsMap[channelId][streamId];
        break;
      }
      case 'server/setPluginsMetadata': {
        draft.pluginsMetadata = action.payload;
        break;
      }
      case 'server/setPluginCommands': {
        draft.pluginCommands = action.payload;
        break;
      }
      case 'server/setPluginCapabilityAccess': {
        draft.pluginCapabilityAccess = action.payload;
        break;
      }
      case 'server/setPluginTabs': {
        draft.pluginTabs = action.payload;
        break;
      }
      case 'server/setPluginTabsForPlugin': {
        draft.pluginTabs[action.payload.pluginId] = action.payload.tabs;
        break;
      }
      case 'server/setPluginComponents': {
        draft.pluginComponents = action.payload;
        break;
      }
      case 'server/setActiveFullscreenPluginId': {
        draft.activeFullscreenPluginId = action.payload;

        if (action.payload) {
          draft.selectedChannelId = undefined;
          draft.dmsOpen = false;
        }
        break;
      }
      case 'server/setDmsOpen': {
        draft.dmsOpen = action.payload;

        if (action.payload) {
          draft.selectedChannelId = undefined;
          draft.activeFullscreenPluginId = undefined;
        }
        break;
      }
    }
  });

export {
  initialState as serverInitialState,
  serverSliceActions,
  serverSliceReducer
};
