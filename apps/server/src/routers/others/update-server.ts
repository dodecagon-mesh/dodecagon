import { Permission } from '@dodecagon/shared';
import { updater } from '../../helpers/updater';
import { protectedProcedure } from '../../utils/trpc';

const updateServerRoute = protectedProcedure.mutation(async ({ ctx }) => {
  await ctx.needsPermission(Permission.MANAGE_UPDATES);

  return updater.update();
});

export { updateServerRoute };
