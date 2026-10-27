import { StreamKind } from '@dodecagon/shared';
import { z } from 'zod';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const pauseConsumerRoute = protectedProcedure
  .input(
    z.object({
      remoteId: z.number(),
      kind: z.enum([StreamKind.SCREEN, StreamKind.SCREEN_AUDIO])
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { runtime, mediaGeneration, assertCurrent } =
      await getCurrentVoiceRuntime(ctx);
    assertCurrent();
    runtime.assertMediaAllowed(ctx.user.id, input.kind, mediaGeneration);

    const consumer = runtime.getConsumer(
      ctx.user.id,
      input.remoteId,
      input.kind
    );

    invariant(consumer, {
      code: 'NOT_FOUND',
      message: 'Consumer not found'
    });

    const applied = await runtime.applyConsumerPlaybackState(
      ctx.user.id,
      input.remoteId,
      input.kind,
      consumer,
      'paused'
    );
    assertCurrent();
    if (!applied) return;

    if (input.kind === StreamKind.SCREEN) {
      runtime.publishScreenViewers();
    }
  });

export { pauseConsumerRoute };
