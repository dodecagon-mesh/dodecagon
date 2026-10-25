import { ChannelType, ServerEvents } from '@dodecagon/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { unpublishHiddenChannelFromUser } from '../../db/publishers';
import { channels } from '../../db/schema';
import { getCurrentVoiceRuntime } from '../../helpers/get-current-voice-runtime';
import { logger } from '../../logger';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const leaveVoiceRoute = protectedProcedure.mutation(async ({ ctx }) => {
  const { runtime, channelId, assertCurrent } =
    await getCurrentVoiceRuntime(ctx);

  const channel = await db
    .select({
      id: channels.id,
      name: channels.name,
      type: channels.type
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .get();

  invariant(channel, {
    code: 'NOT_FOUND',
    message: 'Channel not found'
  });

  invariant(channel.type === ChannelType.VOICE, {
    code: 'BAD_REQUEST',
    message: 'Channel is not a voice channel'
  });

  const userInChannel = runtime.getUser(ctx.user.id);

  invariant(userInChannel, {
    code: 'BAD_REQUEST',
    message: 'User not in voice channel'
  });
  assertCurrent();
  const sessionId = runtime.getSessionId(ctx.user.id)!;
  ctx.currentVoiceChannelId = undefined;

  runtime.removeUser(ctx.user.id);

  ctx.pubsub.publish(ServerEvents.USER_LEAVE_VOICE, {
    channelId,
    userId: ctx.user.id,
    sessionId
  });

  await unpublishHiddenChannelFromUser(ctx.user.id, channel.id);

  logger.info('%s left voice channel %s', ctx.user.name, channel.name);
});

export { leaveVoiceRoute };
