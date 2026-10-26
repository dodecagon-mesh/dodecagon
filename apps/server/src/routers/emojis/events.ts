import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onEmojiCreateRoute = eventSubscription(ServerEvents.EMOJI_CREATE);
const onEmojiDeleteRoute = eventSubscription(ServerEvents.EMOJI_DELETE);
const onEmojiUpdateRoute = eventSubscription(ServerEvents.EMOJI_UPDATE);

export { onEmojiCreateRoute, onEmojiDeleteRoute, onEmojiUpdateRoute };
