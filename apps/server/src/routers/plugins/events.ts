import { Permission, ServerEvents } from '@dodecagon/shared';
import { eventSubscription, protectedProcedure } from '../../utils/trpc';

// the log stream is the only plugin event that needs a permission, so it keeps
// its own body instead of the shared factory
const onPluginLogRoute = protectedProcedure.subscription(async ({ ctx }) => {
  await ctx.needsPermission(Permission.MANAGE_PLUGINS);

  return ctx.pubsub.subscribe(ServerEvents.PLUGIN_LOG);
});

const onCommandsChangeRoute = eventSubscription(
  ServerEvents.PLUGIN_COMMANDS_CHANGE
);
const onComponentsChangeRoute = eventSubscription(
  ServerEvents.PLUGIN_COMPONENTS_CHANGE
);
const onCapabilityAccessChangeRoute = eventSubscription(
  ServerEvents.PLUGIN_CAPABILITY_ACCESS_CHANGE
);
const onMetadataChangeRoute = eventSubscription(
  ServerEvents.PLUGIN_METADATA_CHANGE
);
const onPushRoute = eventSubscription(ServerEvents.PLUGIN_PUSH, 'caller');

export {
  onCapabilityAccessChangeRoute,
  onCommandsChangeRoute,
  onComponentsChangeRoute,
  onMetadataChangeRoute,
  onPluginLogRoute,
  onPushRoute
};
