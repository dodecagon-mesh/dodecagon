import { useCurrentVoiceChannelId } from '@/features/server/channels/hooks';
import { useOwnUserId } from '@/features/server/users/hooks';
import {
  logVoice,
  logVoiceError,
  logVoiceWarn
} from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import type { TRemoteUserStreamKinds } from '@/types';
import { StreamKind } from '@dodecagon/shared';
import type { RtpCapabilities } from 'mediasoup-client/types';
import type { RefObject } from 'react';
import { type MutableRefObject, useEffect } from 'react';
import { isOwnProducerEvent } from '../helpers';
import type { TConsumeOptions } from './use-transports';

type TEvents = {
  consumeRef: MutableRefObject<
    | ((
        remoteId: number,
        kind: StreamKind,
        rtpCapabilities: RtpCapabilities,
        options?: TConsumeOptions
      ) => Promise<void>)
    | null
  >;
  isViewingDemo: (userId: number) => boolean;
  removeRemoteUserStream: (
    userId: number,
    kind: TRemoteUserStreamKinds
  ) => void;
  closeRemoteUserProducer?: (
    userId: number,
    kind: StreamKind,
    producerId: string
  ) => void;
  removeExternalStreamTrack: (
    streamId: number,
    kind: StreamKind.EXTERNAL_AUDIO | StreamKind.EXTERNAL_VIDEO
  ) => void;
  removeExternalStream: (streamId: number) => void;
  clearRemoteUserStreamsForUser: (userId: number) => void;
  clearViewedDemo: (userId: number) => void;
  onScreenViewerStarted?: (peerId: number) => void;
  rtpCapabilitiesRef: RefObject<RtpCapabilities | null | undefined>;
  isVoiceSessionActive: boolean;
};

const useVoiceEvents = ({
  consumeRef,
  isViewingDemo,
  removeRemoteUserStream,
  closeRemoteUserProducer,
  removeExternalStreamTrack,
  removeExternalStream,
  clearRemoteUserStreamsForUser,
  clearViewedDemo,
  onScreenViewerStarted,
  rtpCapabilitiesRef,
  isVoiceSessionActive
}: TEvents) => {
  const currentVoiceChannelId = useCurrentVoiceChannelId();
  const ownUserId = useOwnUserId();

  useEffect(() => {
    if (!currentVoiceChannelId) {
      logVoice('events: not subscribed, no voice channel');
      return;
    }

    if (!isVoiceSessionActive) {
      logVoice('events: not subscribed, voice session not established yet');
      return;
    }

    const trpc = getTRPCClient();

    let isCleaningUp = false;

    const onVoiceNewProducerSub = trpc.voice.onNewProducer.subscribe(
      undefined,
      {
        onData: ({ remoteId, kind, channelId, replaceConsumerId }) => {
          if (currentVoiceChannelId !== channelId || isCleaningUp) return;

          if (isOwnProducerEvent(remoteId, ownUserId, kind)) {
            logVoice('events: ignoring own new producer', { kind, channelId });

            return;
          }

          logVoice('events: new producer', { remoteId, kind, channelId });

          const rtpCapabilities = rtpCapabilitiesRef.current;

          // init sets the ref before it consumes the existing producers, so anything that
          // lands in the gap is picked up by that pass instead
          if (!rtpCapabilities) {
            logVoiceWarn('events: new producer ignored, no rtp capabilities', {
              remoteId,
              kind
            });

            return;
          }

          // Demos are opt-in. If this is a SCREEN / SCREEN_AUDIO producer and
          // the local viewer is not currently viewing this user's demo, do
          // not consume. The viewer must click "View demo" to start.
          if (
            (kind === StreamKind.SCREEN || kind === StreamKind.SCREEN_AUDIO) &&
            !isViewingDemo(remoteId)
          ) {
            logVoice('Skipping demo producer (not viewing)', {
              remoteId,
              kind,
              channelId
            });
            return;
          }
          try {
            consumeRef.current?.(remoteId, kind, rtpCapabilities, {
              replaceConsumerId
            });
          } catch (error) {
            logVoiceError('events: consuming new producer failed', error, {
              remoteId,
              kind,
              channelId
            });
          }
        },
        onError: (error) => {
          logVoiceError('events: new producer subscription error', error);
        }
      }
    );

    const onVoiceProducerClosedSub = trpc.voice.onProducerClosed.subscribe(
      undefined,
      {
        onData: ({ channelId, remoteId, kind, producerId }) => {
          if (currentVoiceChannelId !== channelId || isCleaningUp) return;

          logVoice('events: producer closed', { remoteId, kind, channelId });

          try {
            if (
              kind === StreamKind.EXTERNAL_VIDEO ||
              kind === StreamKind.EXTERNAL_AUDIO
            ) {
              removeExternalStreamTrack(remoteId, kind);
            } else if (producerId && closeRemoteUserProducer) {
              closeRemoteUserProducer(remoteId, kind, producerId);
            } else {
              removeRemoteUserStream(remoteId, kind);
            }
          } catch (error) {
            logVoiceError(
              'events: removing stream for closed producer failed',
              error,
              { remoteId, kind, channelId }
            );
          }
        },
        onError: (error) => {
          logVoiceError('events: producer closed subscription error', error);
        }
      }
    );

    const onScreenConsumerStartedSub =
      trpc.voice.onScreenConsumerStarted.subscribe(undefined, {
        onData: ({ channelId, peerId }) => {
          if (currentVoiceChannelId !== channelId || isCleaningUp) return;
          logVoice('events: viewer started watching screen', {
            peerId,
            channelId
          });
          onScreenViewerStarted?.(peerId);
        },
        onError: (error) => {
          logVoiceError('events: screen consumer subscription error', error);
        }
      });

    const onVoiceUserLeaveSub = trpc.voice.onLeave.subscribe(undefined, {
      onData: ({ channelId, userId }) => {
        if (currentVoiceChannelId !== channelId || isCleaningUp) return;

        logVoice('events: user left voice', { userId, channelId });

        try {
          clearRemoteUserStreamsForUser(userId);
          clearViewedDemo(userId);
        } catch (error) {
          logVoiceError('events: clearing streams for user failed', error, {
            userId
          });
        }
      },
      onError: (error) => {
        logVoiceError('events: user leave subscription error', error);
      }
    });

    const onVoiceRemoveExternalStreamSub =
      trpc.voice.onRemoveExternalStream.subscribe(undefined, {
        onData: ({ channelId, streamId }) => {
          if (currentVoiceChannelId !== channelId || isCleaningUp) return;

          logVoice('events: external stream removed', {
            streamId,
            channelId
          });

          try {
            removeExternalStream(streamId);
          } catch (error) {
            logVoiceError('events: removing external stream failed', error, {
              streamId,
              channelId
            });
          }
        },
        onError: (error) => {
          logVoiceError('events: external stream subscription error', error);
        }
      });

    return () => {
      logVoice('events: unsubscribing');

      isCleaningUp = true;

      onVoiceNewProducerSub.unsubscribe();
      onVoiceProducerClosedSub.unsubscribe();
      onScreenConsumerStartedSub.unsubscribe();
      onVoiceUserLeaveSub.unsubscribe();
      onVoiceRemoveExternalStreamSub.unsubscribe();
    };
  }, [
    currentVoiceChannelId,
    ownUserId,
    consumeRef,
    isViewingDemo,
    removeRemoteUserStream,
    closeRemoteUserProducer,
    removeExternalStreamTrack,
    removeExternalStream,
    clearRemoteUserStreamsForUser,
    clearViewedDemo,
    onScreenViewerStarted,
    rtpCapabilitiesRef,
    isVoiceSessionActive
  ]);
};

export { useVoiceEvents };
