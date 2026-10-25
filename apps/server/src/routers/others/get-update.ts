import { Permission } from '@dodecagon/shared';
import { updater } from '../../helpers/updater';
import { SERVER_VERSION } from '../../utils/env';
import { protectedProcedure } from '../../utils/trpc';

const getUpdateRoute = protectedProcedure.query(async ({ ctx }) => {
  await ctx.needsPermission(Permission.MANAGE_UPDATES);

  const [latestVersion, hasUpdate] = await Promise.all([
    updater.getLatestVersion(),
    updater.hasUpdates()
  ]);

  return {
    canUpdate: updater.canUpdate(),
    latestVersion,
    hasUpdate,
    currentVersion: SERVER_VERSION
  };
});

export { getUpdateRoute };
