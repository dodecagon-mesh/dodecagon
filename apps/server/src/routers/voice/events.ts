import {
  ChannelPermission,
  ServerEvents,
  type StreamKind,
  type TDirectMediaEvent,
  type TRelayDemandEvent,
  type TScreenViewersSnapshot
} from '@dodecagon/shared';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import { config } from '../../config';
import { getDirectMediaRuntime } from '../../helpers/get-direct-media-runtime';
import { VoiceRuntime } from '../../runtimes/voice';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

type TVoiceProducerEvent = {
  channelId: number;
  remoteId: number;
  kind: StreamKind;
};

type TVoiceProducerClosedEvent = TVoiceProducerEvent & {
  producerId: string;
};

type TScreenConsumerStartedEvent = {
  channelId: number;
  producerId: string;
  peerId: number;
};

// these events are broadcast to ALL users (for UI population in the sidebar)
const onUserJoinVoiceRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.USER_JOIN_VOICE);
  }
);

const onUserLeaveVoiceRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.USER_LEAVE_VOICE);
  }
);

const onUserUpdateVoiceStateRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.USER_VOICE_STATE_UPDATE);
  }
);

// broadcast too: reactions render on the voice cards of whichever channel the user is
// looking at, which is not necessarily the one they are connected to
const onUserVoiceReactionRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.USER_VOICE_REACTION);
  }
);

const onUserVoiceMovedRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribeFor(ctx.user.id, ServerEvents.USER_VOICE_MOVED);
  }
);

// these events are broadcast to ALL users (for external stream UI in the sidebar)
const onVoiceAddExternalStreamRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.VOICE_ADD_EXTERNAL_STREAM);
  }
);

const onVoiceUpdateExternalStreamRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.VOICE_UPDATE_EXTERNAL_STREAM);
  }
);

const onVoiceRemoveExternalStreamRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    return ctx.pubsub.subscribe(ServerEvents.VOICE_REMOVE_EXTERNAL_STREAM);
  }
);

// these events are channel-scoped (only sent to users in the same voice channel)
// they relate to actual media streaming, not UI state
const onVoiceNewProducerRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    if (!ctx.currentVoiceChannelId) {
      return observable<TVoiceProducerEvent>(() => () => {});
    }

    const channelId = ctx.currentVoiceChannelId;
    return observable<TVoiceProducerEvent>((observer) => {
      const next = (event: TVoiceProducerEvent) => {
        if (
          event.channelId !== channelId ||
          ctx.currentVoiceChannelId !== channelId
        )
          return;
        const runtime = VoiceRuntime.findById(channelId);
        if (
          !runtime?.getUser(ctx.user.id) ||
          runtime.hasReadyDirectMedia(event.remoteId, ctx.user.id, event.kind)
        )
          return;
        observer.next(event);
      };
      const channel = ctx.pubsub
        .subscribeForChannel(channelId, ServerEvents.VOICE_NEW_PRODUCER)
        .subscribe({
          next,
          error: (error) => observer.error(error)
        });
      const targeted = ctx.pubsub
        .subscribeFor(ctx.user.id, ServerEvents.VOICE_NEW_PRODUCER)
        .subscribe({
          next,
          error: (error) => observer.error(error)
        });
      return () => {
        channel.unsubscribe();
        targeted.unsubscribe();
      };
    });
  }
);

const onVoiceProducerClosedRoute = protectedProcedure.subscription(
  async ({ ctx }) => {
    if (!ctx.currentVoiceChannelId) {
      return observable<TVoiceProducerClosedEvent>(() => () => {});
    }

    return ctx.pubsub.subscribeForChannel(
      ctx.currentVoiceChannelId,
      ServerEvents.VOICE_PRODUCER_CLOSED
    );
  }
);

const onRelayDemandRoute = protectedProcedure.subscription(async ({ ctx }) => {
  const { runtime, channelId } = await getDirectMediaRuntime(ctx);
  const member = runtime.getUser(ctx.user.id);
  return observable<TRelayDemandEvent>((observer) => {
    if (
      ctx.currentVoiceChannelId !== channelId ||
      VoiceRuntime.findById(channelId) !== runtime ||
      runtime.getUser(ctx.user.id) !== member
    )
      return () => {};
    const subscription = ctx.pubsub
      .subscribeFor(ctx.user.id, ServerEvents.VOICE_RELAY_DEMAND)
      .subscribe({
        next: (event) => {
          if (
            event.channelId !== channelId ||
            ctx.currentVoiceChannelId !== channelId ||
            VoiceRuntime.findById(channelId) !== runtime ||
            runtime.getUser(ctx.user.id) !== member
          )
            return;
          observer.next(event);
        },
        error: (error) => observer.error(error)
      });
    for (const event of runtime.getRelayDemand(ctx.user.id))
      observer.next(event);
    return () => subscription.unsubscribe();
  });
});

const onDirectMediaSignalRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.voiceStream.maxRequests,
  windowMs: config.rateLimiters.voiceStream.windowMs,
  logLabel: 'onDirectMediaSignal'
})
  .input(
    z.strictObject({ enabled: z.boolean(), transport: z.literal('holepunch') })
  )
  .subscription(async ({ ctx, input }) => {
    const { runtime, channelId } = await getDirectMediaRuntime(ctx);
    const member = runtime.getUser(ctx.user.id);
    return observable<TDirectMediaEvent>((observer) => {
      if (
        ctx.currentVoiceChannelId !== channelId ||
        VoiceRuntime.findById(channelId) !== runtime ||
        runtime.getUser(ctx.user.id) !== member
      )
        return () => {};
      const registration = runtime.registerDirectMediaSubscriber(
        ctx.user.id,
        input.enabled
      );
      const subscription = ctx.pubsub
        .subscribeFor(ctx.user.id, ServerEvents.DIRECT_MEDIA_SIGNAL)
        .subscribe({
          next: (event) => {
            if (event.channelId !== channelId) return;
            const terminal =
              event.signal.type === 'fallback' || event.signal.type === 'stop';
            if (
              !terminal &&
              (!input.enabled ||
                !registration.isCurrent() ||
                ctx.currentVoiceChannelId !== channelId ||
                runtime.getUser(ctx.user.id) !== member)
            )
              return;
            observer.next(event);
          },
          error: (error) => observer.error(error)
        });
      return () => {
        subscription.unsubscribe();
        registration.unregister();
      };
    });
  });

const onScreenViewersRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.voiceStream.maxRequests,
  windowMs: config.rateLimiters.voiceStream.windowMs,
  logLabel: 'onScreenViewers'
})
  .input(z.strictObject({ channelId: z.number().int().positive() }))
  .subscription(async ({ ctx, input }) => {
    await ctx.needsChannelPermission(
      input.channelId,
      ChannelPermission.VIEW_CHANNEL
    );

    return observable<TScreenViewersSnapshot>((observer) => {
      const emitSnapshot = () => {
        const runtime = VoiceRuntime.findById(input.channelId);
        const snapshot = runtime?.getScreenViewers();

        observer.next(snapshot ?? { channelId: input.channelId, demos: {} });
      };

      const subscription = ctx.pubsub
        .subscribe(ServerEvents.VOICE_SCREEN_VIEWERS_CHANGED)
        .subscribe({
          next: (event) => {
            if (event.channelId !== input.channelId) return;
            emitSnapshot();
          },
          error: (error) => observer.error(error)
        });

      emitSnapshot();

      return () => subscription.unsubscribe();
    });
  });

const onScreenConsumerStartedRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.voiceStream.maxRequests,
  windowMs: config.rateLimiters.voiceStream.windowMs,
  logLabel: 'onScreenConsumerStarted'
}).subscription(async ({ ctx }) => {
  const channelId = ctx.currentVoiceChannelId;
  const runtime = channelId ? VoiceRuntime.findById(channelId) : undefined;
  const member = runtime?.getUser(ctx.user.id);
  return observable<TScreenConsumerStartedEvent>((observer) => {
    if (!channelId || !runtime || !member) return () => {};
    const subscription = ctx.pubsub
      .subscribeFor(ctx.user.id, ServerEvents.VOICE_SCREEN_CONSUMER_STARTED)
      .subscribe({
        next: (event) => {
          if (event.channelId !== channelId) return;
          if (VoiceRuntime.findById(channelId) !== runtime) return;
          observer.next(event);
        }
      });
    return () => subscription.unsubscribe();
  });
});

export {
  onDirectMediaSignalRoute,
  onRelayDemandRoute,
  onScreenConsumerStartedRoute,
  onScreenViewersRoute,
  onUserJoinVoiceRoute,
  onUserLeaveVoiceRoute,
  onUserUpdateVoiceStateRoute,
  onUserVoiceMovedRoute,
  onUserVoiceReactionRoute,
  onVoiceAddExternalStreamRoute,
  onVoiceNewProducerRoute,
  onVoiceProducerClosedRoute,
  onVoiceRemoveExternalStreamRoute,
  onVoiceUpdateExternalStreamRoute
};
