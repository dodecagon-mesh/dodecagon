import { ServerEvents, StreamKind } from '@dodecagon/shared';
import { z } from 'zod';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const resumeConsumerRoute = protectedProcedure
  .input(
    z.object({
      remoteId: z.number(),
      consumerId: z.string().min(1),
      kind: z.enum([
        StreamKind.VIDEO,
        StreamKind.SCREEN,
        StreamKind.SCREEN_AUDIO,
        StreamKind.EXTERNAL_VIDEO
      ]),
      requestDirect: z.boolean().optional()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { runtime, channelId, mediaGeneration, assertCurrent } =
      await getCurrentVoiceRuntime(ctx);
    assertCurrent();
    runtime.assertMediaAllowed(ctx.user.id, input.kind, mediaGeneration);

    const consumer = runtime.getConsumer(
      ctx.user.id,
      input.remoteId,
      input.kind
    );

    invariant(consumer && consumer.id === input.consumerId, {
      code: 'NOT_FOUND',
      message: 'Consumer not found'
    });

    const applied = await runtime.applyConsumerPlaybackState(
      ctx.user.id,
      input.remoteId,
      input.kind,
      consumer,
      'active'
    );
    assertCurrent();
    if (!applied) return;

    if (input.kind === StreamKind.SCREEN) {
      runtime.publishScreenViewers();
    }

    if (
      input.kind === StreamKind.SCREEN &&
      channelId &&
      input.requestDirect !== false
    ) {
      // re-watching a demo after an idle pause is a fresh direct attempt.
      ctx.pubsub.publishFor(
        [input.remoteId],
        ServerEvents.VOICE_SCREEN_CONSUMER_STARTED,
        {
          channelId,
          producerId: consumer.producerId,
          peerId: ctx.user.id
        }
      );
    }
  });

export { resumeConsumerRoute };
