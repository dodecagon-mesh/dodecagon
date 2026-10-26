import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription, t } from '../../utils/trpc';
import { getDirectMessagesRoute } from './get-direct-messages';
import { openDirectMessageRoute } from './open-direct-message';

const onDmConversationOpenRoute = eventSubscription(
  ServerEvents.DM_CONVERSATION_OPEN,
  'caller'
);

export const dmsRouter = t.router({
  get: getDirectMessagesRoute,
  open: openDirectMessageRoute,
  onConversationOpen: onDmConversationOpenRoute
});
