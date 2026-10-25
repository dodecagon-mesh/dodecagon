import { z } from 'zod';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const connectConsumerTransportRoute = protectedProcedure
  .input(
    z.object({
      dtlsParameters: z.any()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const { runtime, assertCurrent } = await getCurrentVoiceRuntime(ctx);
    assertCurrent();

    const consumerTransport = runtime.getConsumerTransport(ctx.user.id);

    invariant(consumerTransport, {
      code: 'NOT_FOUND',
      message: 'Consumer transport not found'
    });

    await consumerTransport.connect({ dtlsParameters: input.dtlsParameters });
  });

export { connectConsumerTransportRoute };
