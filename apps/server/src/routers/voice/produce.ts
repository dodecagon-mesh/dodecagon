import {
  getMediasoupKind,
  PRODUCIBLE_STREAM_KINDS,
  ServerEvents
} from '@dodecagon/shared';
import { z } from 'zod';
import { config } from '../../config';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { voiceKindPermissions } from '../../helpers/voice-kind-permissions';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const produceRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.voiceStream.maxRequests,
  windowMs: config.rateLimiters.voiceStream.windowMs,
  logLabel: 'produce'
})
  .input(
    z.object({
      transportId: z.string(),
      kind: z.enum(PRODUCIBLE_STREAM_KINDS),
      rtpParameters: z.any(),
      qualityLayers: z
        .array(
          z.object({
            spatialLayer: z.number().int().nonnegative(),
            label: z.string().trim().min(1)
          })
        )
        .optional()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { runtime, channelId, mediaGeneration, assertCurrent } =
      await getCurrentVoiceRuntime(ctx);

    const { channel, server } = voiceKindPermissions[input.kind];

    await ctx.needsChannelPermission(channelId, channel);

    if (server) {
      await ctx.needsPermission(server);
    }
    assertCurrent();
    runtime.assertMediaAllowed(ctx.user.id, input.kind, mediaGeneration);

    const producerTransport = runtime.getProducerTransport(ctx.user.id);

    invariant(producerTransport, {
      code: 'NOT_FOUND',
      message: 'Producer transport not found'
    });

    const producer = await producerTransport.produce({
      kind: getMediasoupKind(input.kind),
      rtpParameters: input.rtpParameters,
      appData: { kind: input.kind, userId: ctx.user.id }
    });
    try {
      assertCurrent();
    } catch (error) {
      producer.close();
      throw error;
    }

    runtime.addProducer(
      ctx.user.id,
      input.kind,
      producer,
      input.qualityLayers,
      mediaGeneration
    );

    ctx.pubsub.publishForChannel(channelId, ServerEvents.VOICE_NEW_PRODUCER, {
      channelId: channelId,
      remoteId: ctx.user.id,
      kind: input.kind
    });

    return producer.id;
  });

export { produceRoute };
