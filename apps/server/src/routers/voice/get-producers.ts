import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { protectedProcedure } from '../../utils/trpc';

const getProducersRoute = protectedProcedure.query(async ({ ctx }) => {
  const { runtime, assertCurrent } = await getCurrentVoiceRuntime(ctx);
  assertCurrent();

  return runtime.getRemoteIds(ctx.user.id);
});

export { getProducersRoute };
