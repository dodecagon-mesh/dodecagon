import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onUserJoinRoute = eventSubscription(ServerEvents.USER_JOIN);
const onUserLeaveRoute = eventSubscription(ServerEvents.USER_LEAVE);
const onUserUpdateRoute = eventSubscription(ServerEvents.USER_UPDATE);
const onUserCreateRoute = eventSubscription(ServerEvents.USER_CREATE);
const onUserDeleteRoute = eventSubscription(ServerEvents.USER_DELETE);

export {
  onUserCreateRoute,
  onUserDeleteRoute,
  onUserJoinRoute,
  onUserLeaveRoute,
  onUserUpdateRoute
};
