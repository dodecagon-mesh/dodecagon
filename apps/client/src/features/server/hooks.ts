import { useStoreSelector } from '@/features/store';
import { useStore } from '@/features/store-context';
import { ChannelPermission, Permission } from '@dodecagon/shared';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { IRootState } from '../store';
import { useChannelById, useChannelPermissionsById } from './channels/hooks';
import { channelReadStateByIdSelector } from './channels/selectors';
import { hasUnreadMentionInMessages } from './helpers';
import {
  getMessageDatabaseScope,
  getMessageQueryClient,
  readLoadedMessages
} from './messages/database';
import {
  activeDmChannelIdSelector,
  activeFullscreenPluginIdSelector,
  categoryUnreadMessagesCountSelector,
  connectedSelector,
  currentVoicePeersSelector,
  disconnectInfoSelector,
  dmsOpenSelector,
  hasSharingScreenUsersSelector,
  hasVisibleChannelsInCategorySelector,
  hiddenPluginComponentsSelector,
  infoSelector,
  isOwnUserOwnerSelector,
  ownUserRolesSelector,
  ownVoiceUserSelector,
  pluginsEnabledSelector,
  publicServerSettingsSelector,
  reconnectingSelector,
  reconnectSelector,
  referenceableChannelsSelector,
  serverNameSelector,
  totalUnreadCountSelector,
  typingUsersByChannelIdSelector,
  typingUsersByThreadIdSelector,
  userRolesSelector,
  userSettingsPluginsSelector,
  visibleChannelsInCategorySelector,
  voiceUsersByChannelIdSelector,
  webRtcSimulcastEnabledSelector
} from './selectors';
import { ownUserIdSelector, ownUserRoleIdsSelector } from './users/selectors';

export const useIsConnected = () => useStoreSelector(connectedSelector);

export const useIsReconnecting = () => useStoreSelector(reconnectingSelector);

export const useReconnectState = () => useStoreSelector(reconnectSelector);

export const useDisconnectInfo = () => useStoreSelector(disconnectInfoSelector);

export const useServerName = () => useStoreSelector(serverNameSelector);

export const useTotalUnreadCount = () =>
  useStoreSelector(totalUnreadCountSelector);

export const usePublicServerSettings = () =>
  useStoreSelector(publicServerSettingsSelector);

export const useWebRtcSimulcastEnabled = () =>
  useStoreSelector(webRtcSimulcastEnabledSelector);

export const useCurrentVoicePeers = () =>
  useStoreSelector(currentVoicePeersSelector);

export const useOwnUserRoles = () => useStoreSelector(ownUserRolesSelector);

export const useHiddenPluginComponents = () =>
  useStoreSelector(hiddenPluginComponentsSelector);

export const useInfo = () => useStoreSelector(infoSelector);

export const useIsOwnUserOwner = () => useStoreSelector(isOwnUserOwnerSelector);

export const useReferenceableChannels = () =>
  useStoreSelector(referenceableChannelsSelector);

export const usePluginsEnabled = () => useStoreSelector(pluginsEnabledSelector);

export const useCan = () => {
  const ownUserRoles = useOwnUserRoles();
  const isOwner = useIsOwnUserOwner();

  // TODO: maybe this can can recieve both Permission and ChannelPermission?
  const can = useCallback(
    (permission: Permission | Permission[]) => {
      if (isOwner) return true;

      const permissionsToCheck = Array.isArray(permission)
        ? permission
        : [permission];

      for (const role of ownUserRoles) {
        for (const perm of role.permissions) {
          if (permissionsToCheck.includes(perm)) {
            return true;
          }
        }
      }

      return false;
    },
    [ownUserRoles, isOwner]
  );

  return can;
};

export const useChannelCan = (channelId: number | undefined) => {
  const ownUserRoles = useChannelPermissionsById(channelId || -1);
  const isOwner = useIsOwnUserOwner();
  const channel = useChannelById(channelId || -1);

  const can = useCallback(
    (permission: ChannelPermission) => {
      if (isOwner || !channel || !channel?.private) return true;

      // if VIEW is false, no other permission matters
      if (ownUserRoles.permissions[ChannelPermission.VIEW_CHANNEL] === false)
        return false;

      return ownUserRoles.permissions[permission] === true;
    },
    [ownUserRoles, isOwner, channel]
  );

  return can;
};

// Returns true if the user can view at least one of the channels in the category
export const useHasVisibleChannelsInCategory = (categoryId: number) =>
  useStoreSelector((state: IRootState) =>
    hasVisibleChannelsInCategorySelector(state, categoryId)
  );

export const useUserRoles = (userId: number) =>
  useStoreSelector((state: IRootState) => userRolesSelector(state, userId));

export const useTypingUsersByChannelId = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    typingUsersByChannelIdSelector(state, channelId)
  );

export const useTypingUsersByThreadId = (parentMessageId: number) =>
  useStoreSelector((state: IRootState) =>
    typingUsersByThreadIdSelector(state, parentMessageId)
  );

export const useVoiceUsersByChannelId = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    voiceUsersByChannelIdSelector(state, channelId)
  );

export const useOwnVoiceUser = () => useStoreSelector(ownVoiceUserSelector);

export const useUnreadMessagesCount = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    channelReadStateByIdSelector(state, channelId)
  );

export const useCategoryUnreadMessagesCount = (categoryId: number) =>
  useStoreSelector((state: IRootState) =>
    categoryUnreadMessagesCountSelector(state, categoryId)
  );

export const useCategoryHasUnreadMentions = (categoryId: number) => {
  const currentStore = useStore();
  const channels = useStoreSelector((state) =>
    visibleChannelsInCategorySelector(state, categoryId)
  );
  const readStates = useStoreSelector((state) => state.server.readStatesMap);
  const ownUserId = useStoreSelector(ownUserIdSelector);
  const ownRoleIds = useStoreSelector(ownUserRoleIdsSelector);
  useStoreSelector((state) => state.server.serverId);
  const queryClient = getMessageQueryClient(currentStore);
  const scope = getMessageDatabaseScope(currentStore);
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (
          key[0] === 'messages' &&
          key[1] === scope &&
          key[3] === 'root' &&
          key[4] === 'rows' &&
          channels.some((channel) => channel.id === key[2])
        )
          listener();
      }),
    [queryClient, scope, channels]
  );
  const getSnapshot = useCallback(
    () =>
      channels.some((channel) =>
        hasUnreadMentionInMessages(
          readStates[channel.id] ?? 0,
          readLoadedMessages(currentStore, channel.id),
          ownUserId,
          ownRoleIds
        )
      ),
    [currentStore, channels, readStates, ownUserId, ownRoleIds]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const useCategoryUnreadData = (categoryId: number) => {
  const unreadCount = useCategoryUnreadMessagesCount(categoryId);
  const hasUnreadMentions = useCategoryHasUnreadMentions(categoryId);

  return useMemo(
    () => ({ unreadCount, hasUnreadMentions }),
    [unreadCount, hasUnreadMentions]
  );
};

export const useHasSharingScreenUsers = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    hasSharingScreenUsersSelector(state, channelId)
  );

export const useHasUnreadMentions = (channelId: number) => {
  const currentStore = useStore();
  const readState = useUnreadMessagesCount(channelId);
  const ownUserId = useStoreSelector(ownUserIdSelector);
  const ownRoleIds = useStoreSelector(ownUserRoleIdsSelector);
  useStoreSelector((state) => state.server.serverId);
  const scope = getMessageDatabaseScope(currentStore);
  const queryClient = getMessageQueryClient(currentStore);
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (
          key[0] === 'messages' &&
          key[1] === scope &&
          key[2] === channelId &&
          key[3] === 'root' &&
          key[4] === 'rows'
        )
          listener();
      }),
    [queryClient, scope, channelId]
  );
  const getSnapshot = useCallback(
    () =>
      hasUnreadMentionInMessages(
        readState,
        readLoadedMessages(currentStore, channelId),
        ownUserId,
        ownRoleIds
      ),
    [currentStore, channelId, readState, ownUserId, ownRoleIds]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const useActiveFullscreenPluginId = () =>
  useStoreSelector(activeFullscreenPluginIdSelector);

export const useDmsOpen = () => useStoreSelector(dmsOpenSelector);

export const useActiveDmChannelId = () =>
  useStoreSelector(activeDmChannelIdSelector);

export const useUserSettingsPlugins = () =>
  useStoreSelector(userSettingsPluginsSelector);
