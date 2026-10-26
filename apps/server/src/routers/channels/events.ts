import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onChannelCreateRoute = eventSubscription(
  ServerEvents.CHANNEL_CREATE,
  'caller'
);
const onChannelDeleteRoute = eventSubscription(
  ServerEvents.CHANNEL_DELETE,
  'caller'
);
const onChannelUpdateRoute = eventSubscription(
  ServerEvents.CHANNEL_UPDATE,
  'caller'
);
const onChannelPermissionsUpdateRoute = eventSubscription(
  ServerEvents.CHANNEL_PERMISSIONS_UPDATE,
  'caller'
);
const onChannelReadStatesUpdateRoute = eventSubscription(
  ServerEvents.CHANNEL_READ_STATES_UPDATE,
  'caller'
);
const onChannelReadStatesDeltaRoute = eventSubscription(
  ServerEvents.CHANNEL_READ_STATES_DELTA,
  'caller'
);

export {
  onChannelCreateRoute,
  onChannelDeleteRoute,
  onChannelPermissionsUpdateRoute,
  onChannelReadStatesDeltaRoute,
  onChannelReadStatesUpdateRoute,
  onChannelUpdateRoute
};
