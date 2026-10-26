import { ServerEvents } from '@dodecagon/shared';
import { eventSubscription } from '../../utils/trpc';

const onRoleCreateRoute = eventSubscription(ServerEvents.ROLE_CREATE);
const onRoleDeleteRoute = eventSubscription(ServerEvents.ROLE_DELETE);
const onRoleUpdateRoute = eventSubscription(ServerEvents.ROLE_UPDATE);

export { onRoleCreateRoute, onRoleDeleteRoute, onRoleUpdateRoute };
