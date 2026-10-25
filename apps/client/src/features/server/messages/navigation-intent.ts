import type { IRootState } from '@/features/store';
import { ChannelPermission, ChannelType } from '@dodecagon/shared';
import {
  channelByIdSelector,
  channelPermissionsByIdSelector
} from '../channels/selectors';
import { canViewChannel } from '../helpers';
import { isOwnUserOwnerSelector } from '../selectors';
import { ownUserIdSelector } from '../users/selectors';

export const canReadMessageChannel = (state: IRootState, channelId: number) => {
  const channel = channelByIdSelector(state, channelId);
  if (!channel || ownUserIdSelector(state) === undefined) return false;
  const permissions = channelPermissionsByIdSelector(state, channelId);
  // DM membership is the rule even for owners; the server grants VIEW only to participants
  if (channel.isDm)
    return permissions.permissions?.[ChannelPermission.VIEW_CHANNEL] === true;
  return canViewChannel(
    channel,
    state.server.channelPermissions,
    isOwnUserOwnerSelector(state)
  );
};

export const canPrefetchMessages = (state: IRootState, channelId: number) => {
  const channel = channelByIdSelector(state, channelId);
  return (
    state.server.connected &&
    channel?.type === ChannelType.TEXT &&
    canReadMessageChannel(state, channelId)
  );
};
