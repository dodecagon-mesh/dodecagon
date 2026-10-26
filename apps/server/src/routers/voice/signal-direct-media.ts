import {
  ChannelPermission,
  DIRECT_MEDIA_SDP_MAX_LENGTH,
  Permission
} from '@dodecagon/shared';
import { z } from 'zod';
import { config } from '../../config';
import { channelUserCan } from '../../db/queries/channels';
import { getDirectMediaRuntime } from '../../helpers/get-direct-media-runtime';
import { VoiceRuntime } from '../../runtimes/voice';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

// native WebRTC validates SDP mechanics; the server only bounds and limits its media surface.
const sdp = z
  .string()
  .min(1)
  .max(DIRECT_MEDIA_SDP_MAX_LENGTH)
  .refine(
    (value) =>
      /^v=0(?:\r?\n)/.test(value) &&
      !/^m=(?!audio(?:\s)|video(?:\s))/m.test(value),
    'Invalid direct screen SDP'
  );
const publicKey = z.string().regex(/^[0-9a-f]{64}$/i);
const terminalSignal = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('fallback'),
    reason: z.literal('unwatch').optional()
  }),
  z.strictObject({ type: z.literal('stop') })
]);
const terminalInput = z.strictObject({
  sessionId: z.uuid(),
  signal: terminalSignal
});

const signalDirectMediaRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.voiceStream.maxRequests,
  windowMs: config.rateLimiters.voiceStream.windowMs,
  logLabel: 'signalDirectMedia',
  skip: (rawInput) => terminalInput.safeParse(rawInput).success
})
  .input(
    z.strictObject({
      sessionId: z.uuid(),
      signal: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('offer'), sdp, publicKey }),
        z.strictObject({ type: z.literal('answer'), sdp, publicKey }),
        z.strictObject({ type: z.literal('ready') }),
        ...terminalSignal.options
      ])
    })
  )
  .mutation(async ({ input, ctx }) => {
    await ctx.needsPermission(Permission.JOIN_VOICE_CHANNELS);
    const offering = input.signal.type === 'offer';
    const runtime = ctx.currentVoiceChannelId
      ? VoiceRuntime.findById(ctx.currentVoiceChannelId)
      : undefined;
    const terminal =
      input.signal.type === 'fallback' || input.signal.type === 'stop';
    const session = runtime?.getDirectMediaSession(
      input.sessionId,
      ctx.user.id,
      terminal
    );
    if (terminal && !session) {
      // missing sessions return no metadata, even after leaving or runtime destruction.
      return;
    }
    invariant(session, {
      code: 'NOT_FOUND',
      message: 'Direct screen session not found'
    });
    const current = await getDirectMediaRuntime(
      ctx,
      offering ? session.kind : undefined
    );
    const peerId =
      session.senderId === ctx.user.id ? session.peerId : session.senderId;
    if (
      !terminal &&
      !(await channelUserCan(
        current.channelId,
        peerId,
        ChannelPermission.VIEW_CHANNEL
      ))
    ) {
      current.runtime.invalidateDirectMediaUser(peerId);
      invariant(false, {
        code: 'NOT_FOUND',
        message: 'Direct screen session not found'
      });
    }
    invariant(
      current.runtime === runtime &&
        ctx.currentVoiceChannelId === current.channelId &&
        VoiceRuntime.findById(current.channelId) === runtime,
      {
        code: 'NOT_FOUND',
        message: 'Direct screen session not found'
      }
    );
    await current.runtime.signalDirectMedia(
      input.sessionId,
      ctx.user.id,
      input.signal
    );
  });

export { signalDirectMediaRoute };
