import { ChannelType, type TDirectMediaKind } from '@dodecagon/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { channels } from '../db/schema';
import { invariant } from '../utils/invariant';
import type { Context } from '../utils/trpc';
import { assertChannelAccess } from './assert-channel-access';
import { getCurrentVoiceRuntime } from './get-current-voice-runtime';
import { voiceKindPermissions } from './voice-kind-permissions';

const getDirectMediaRuntime = async (ctx: Context, kind?: TDirectMediaKind) => {
  const { runtime, channelId, assertCurrent } =
    await getCurrentVoiceRuntime(ctx);
  const mediaPermission = kind ? voiceKindPermissions[kind] : undefined;
  if (mediaPermission?.server)
    await ctx.needsPermission(mediaPermission.server);
  const channel = await db
    .select({ type: channels.type, isDm: channels.isDm })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
    .get();
  invariant(channel, { code: 'NOT_FOUND', message: 'Channel not found' });
  invariant(channel.type === ChannelType.VOICE && !channel.isDm, {
    code: 'BAD_REQUEST',
    message: 'Channel is not a voice channel'
  });
  await assertChannelAccess(ctx, channelId);
  if (mediaPermission)
    await ctx.needsChannelPermission(channelId, mediaPermission.channel);
  assertCurrent();
  return { runtime, channelId };
};

export { getDirectMediaRuntime };
