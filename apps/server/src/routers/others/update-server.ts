import { Permission } from '@dodecagon/shared';
import { zUpdateRequest } from '../../helpers/update-request';
import { updater } from '../../helpers/updater';
import { protectedProcedure } from '../../utils/trpc';

// the same request the remote api accepts, so the two entry points cannot drift: an
// absent input asks for the latest release, like the button of the settings screen does
const updateServerRoute = protectedProcedure
  .input(zUpdateRequest.optional())
  .mutation(async ({ ctx, input }) => {
    await ctx.needsPermission(Permission.MANAGE_UPDATES);

    return updater.update(input ?? {});
  });

export { updateServerRoute };
