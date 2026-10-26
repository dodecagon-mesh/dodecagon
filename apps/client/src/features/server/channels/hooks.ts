import { useStoreSelector, type IRootState } from '@/features/store';
import {
  channelByIdSelector,
  channelIdsByCategorySelector,
  channelPermissionsByIdSelector,
  channelsByCategoryIdSelector,
  channelsMapSelector,
  channelsSelector,
  currentVoiceChannelIdSelector,
  directMessagesUnreadCountSelector,
  isCurrentVoiceChannelSelectedSelector,
  selectedChannelIdSelector,
  selectedChannelTypeSelector
} from './selectors';

export const useChannels = () => useStoreSelector(channelsSelector);

export const useChannelById = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    channelByIdSelector(state, channelId)
  );

export const useChannelsByCategoryId = (categoryId: number) =>
  useStoreSelector((state: IRootState) =>
    channelsByCategoryIdSelector(state, categoryId)
  );

export const useChannelIdsByCategory = () =>
  useStoreSelector(channelIdsByCategorySelector);

export const useSelectedChannelId = () =>
  useStoreSelector(selectedChannelIdSelector);

export const useCurrentVoiceChannelId = () =>
  useStoreSelector(currentVoiceChannelIdSelector);

export const useIsCurrentVoiceChannelSelected = () =>
  useStoreSelector(isCurrentVoiceChannelSelectedSelector);

export const useChannelPermissionsById = (channelId: number) =>
  useStoreSelector((state: IRootState) =>
    channelPermissionsByIdSelector(state, channelId)
  );

export const useSelectedChannelType = () =>
  useStoreSelector(selectedChannelTypeSelector);

export const useChannelsMap = () => useStoreSelector(channelsMapSelector);

export const useDirectMessagesUnreadCount = () =>
  useStoreSelector(directMessagesUnreadCountSelector);
