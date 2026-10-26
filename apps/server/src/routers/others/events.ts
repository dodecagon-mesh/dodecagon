import { ServerEvents, type TServerUpdateState } from '@dodecagon/shared';
import { observable } from '@trpc/server/observable';
import { updater } from '../../helpers/updater';
import { eventSubscription, protectedProcedure } from '../../utils/trpc';

const onServerSettingsUpdateRoute = eventSubscription(
  ServerEvents.SERVER_SETTINGS_UPDATE
);

const onServerUpdateStateRoute = protectedProcedure.subscription(({ ctx }) =>
  observable<TServerUpdateState>((observer) => {
    // Attach first, then read the snapshot synchronously so transitions cannot be lost.
    const subscription = ctx.pubsub
      .subscribe(ServerEvents.SERVER_UPDATE_STATE)
      .subscribe({
        next: (state) => observer.next(state),
        error: (error) => observer.error(error)
      });
    observer.next(updater.getUpdateState());
    return () => subscription.unsubscribe();
  })
);

export { onServerSettingsUpdateRoute, onServerUpdateStateRoute };
