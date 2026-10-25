import { useStoreSelector, type IRootState } from '@/features/store';
import { useMemo } from 'react';
import {
  appLoadingSelector,
  autoJoinLastChannelSelector,
  browserNotificationsForDmsSelector,
  browserNotificationsForMentionsSelector,
  browserNotificationsForRepliesSelector,
  browserNotificationsSelector,
  isAutoConnectingSelector,
  isChannelMutedSelector,
  isShiftHeldSelector,
  joinLeaveSoundsSelector,
  loadingPluginsSelector,
  membersPanelOpenSelector,
  messageJumpTargetSelector,
  messageSentSoundSelector,
  modViewOpenSelector,
  modViewUserIdSelector,
  muteDeafenSoundsSelector,
  notificationSoundsSelector,
  pluginSlotDebugSelector,
  selectedDmChannelIdSelector,
  shortcutBindingsSelector,
  shortcutOverridesSelector,
  threadSidebarDataSelector,
  voiceChatSidebarDataSelector
} from './selectors';

export const useIsAppLoading = () => useStoreSelector(appLoadingSelector);

export const useIsAutoConnecting = () =>
  useStoreSelector(isAutoConnectingSelector);

export const useIsPluginsLoading = () =>
  useStoreSelector(loadingPluginsSelector);

export const useModViewOpen = () => {
  const isOpen = useStoreSelector(modViewOpenSelector);
  const userId = useStoreSelector(modViewUserIdSelector);

  return useMemo(() => ({ isOpen, userId }), [isOpen, userId]);
};

export const useThreadSidebar = () =>
  useStoreSelector(threadSidebarDataSelector);

export const useAutoJoinLastChannel = () =>
  useStoreSelector(autoJoinLastChannelSelector);

export const useSelectedDmChannelId = () =>
  useStoreSelector(selectedDmChannelIdSelector);

export const useBrowserNotifications = () =>
  useStoreSelector(browserNotificationsSelector);

export const useBrowserNotificationsForMentions = () =>
  useStoreSelector(browserNotificationsForMentionsSelector);

export const useBrowserNotificationsForDms = () =>
  useStoreSelector(browserNotificationsForDmsSelector);

export const useMessageJumpTarget = () =>
  useStoreSelector(messageJumpTargetSelector);

export const useBrowserNotificationsForReplies = () =>
  useStoreSelector(browserNotificationsForRepliesSelector);

export const useVoiceChatSidebar = () =>
  useStoreSelector(voiceChatSidebarDataSelector);

export const useMembersPanelOpen = () =>
  useStoreSelector(membersPanelOpenSelector);

export const usePluginSlotDebug = () =>
  useStoreSelector(pluginSlotDebugSelector);

export const useIsShiftHeld = () => useStoreSelector(isShiftHeldSelector);

export const useNotificationSounds = () =>
  useStoreSelector(notificationSoundsSelector);

export const useMessageSentSound = () =>
  useStoreSelector(messageSentSoundSelector);

export const useJoinLeaveSounds = () =>
  useStoreSelector(joinLeaveSoundsSelector);

export const useMuteDeafenSounds = () =>
  useStoreSelector(muteDeafenSoundsSelector);

export const useIsChannelMuted = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    isChannelMutedSelector(state, channelId)
  );

export const useShortcutBindings = () =>
  useStoreSelector(shortcutBindingsSelector);

export const useShortcutOverrides = () =>
  useStoreSelector(shortcutOverridesSelector);
