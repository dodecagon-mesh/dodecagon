import { Permission } from '@dodecagon/shared';
import { VoiceRuntime } from '../runtimes/voice';
import { invariant } from '../utils/invariant';
import type { Context } from '../utils/trpc';

const getCurrentVoiceRuntime = async (ctx: Context) => {
  const channelId = ctx.currentVoiceChannelId;
  const runtime = channelId ? VoiceRuntime.findById(channelId) : undefined;
  const mediaGeneration = runtime?.getNonVoiceMediaGeneration(ctx.user.id);
  const member = runtime?.getUser(ctx.user.id);

  await ctx.needsPermission(Permission.JOIN_VOICE_CHANNELS);

  invariant(channelId && channelId === ctx.currentVoiceChannelId, {
    code: 'BAD_REQUEST',
    message: 'User is not in a voice channel'
  });

  invariant(runtime && runtime === VoiceRuntime.findById(channelId), {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Voice runtime not found for this channel'
  });

  const assertCurrent = () => {
    invariant(
      runtime.ownsUser(ctx.user.id, ctx.voiceConnection) &&
        VoiceRuntime.findById(channelId) === runtime &&
        runtime.getUser(ctx.user.id) === member &&
        ctx.currentVoiceChannelId === channelId,
      {
        code: 'BAD_REQUEST',
        message: 'User is not in this voice channel'
      }
    );
  };
  assertCurrent();

  return { runtime, channelId, mediaGeneration, assertCurrent };
};

export { getCurrentVoiceRuntime };
