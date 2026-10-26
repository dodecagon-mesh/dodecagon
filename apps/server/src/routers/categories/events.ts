import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onCategoryCreateRoute = eventSubscription(ServerEvents.CATEGORY_CREATE);
const onCategoryDeleteRoute = eventSubscription(ServerEvents.CATEGORY_DELETE);
const onCategoryUpdateRoute = eventSubscription(ServerEvents.CATEGORY_UPDATE);

export { onCategoryCreateRoute, onCategoryDeleteRoute, onCategoryUpdateRoute };
