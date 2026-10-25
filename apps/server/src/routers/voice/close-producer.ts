import { Permission, ServerEvents, StreamKind } from '@dodecagon/shared';
import z from 'zod';
import { logger } from '../../logger';
import { VoiceRuntime } from '../../runtimes/voice';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const closeProducerRoute = protectedProcedure
  .input(
    z.object({
      kind: z.enum(StreamKind),
      producerId: z.uuid().optional()
    })
  )
  .mutation(async ({ ctx, input }) => {
    await ctx.needsPermission(Permission.JOIN_VOICE_CHANNELS);

    if (!ctx.currentVoiceChannelId) {
      logger.debug(
        'Ignoring closeProducer for %s/%s: user already left voice',
        ctx.user.name,
        input.kind
      );
      return;
    }

    const runtime = VoiceRuntime.findById(ctx.currentVoiceChannelId);

    invariant(runtime, {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Voice runtime not found for this channel'
    });
    invariant(runtime.ownsUser(ctx.user.id, ctx.voiceConnection), {
      code: 'BAD_REQUEST',
      message: 'User is not in this voice channel'
    });

    const producer = runtime.getProducer(input.kind, ctx.user.id);

    if (!producer) {
      logger.debug(
        'Ignoring closeProducer for %s/%s: producer already missing',
        ctx.user.name,
        input.kind
      );
      return;
    }

    if (input.producerId && producer.id !== input.producerId) return;

    runtime.removeProducer(ctx.user.id, input.kind);

    ctx.pubsub.publishForChannel(
      ctx.currentVoiceChannelId,
      ServerEvents.VOICE_PRODUCER_CLOSED,
      {
        channelId: ctx.currentVoiceChannelId,
        remoteId: ctx.user.id,
        kind: input.kind,
        producerId: producer.id
      }
    );
  });

export { closeProducerRoute };
