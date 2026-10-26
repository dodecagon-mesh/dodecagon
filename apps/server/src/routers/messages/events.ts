import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onMessageDeleteRoute = eventSubscription(
  ServerEvents.MESSAGE_DELETE,
  'caller'
);
const onMessageUpdateRoute = eventSubscription(
  ServerEvents.MESSAGE_UPDATE,
  'caller'
);
const onMessageRoute = eventSubscription(ServerEvents.NEW_MESSAGE, 'caller');
const onMessageTypingRoute = eventSubscription(
  ServerEvents.MESSAGE_TYPING,
  'caller'
);
const onThreadReplyCountUpdateRoute = eventSubscription(
  ServerEvents.THREAD_REPLY_COUNT_UPDATE,
  'caller'
);

export {
  onMessageDeleteRoute,
  onMessageRoute,
  onMessageTypingRoute,
  onMessageUpdateRoute,
  onThreadReplyCountUpdateRoute
};
