import { logVoice, logVoiceError } from '@/helpers/browser-logger';
import { getTRPCClient } from '@/lib/trpc';
import {
  StreamKind,
  type TDirectMediaKind,
  type TProducibleStreamKind
} from '@dodecagon/shared';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  DirectMedia,
  type TDirectScreenBundle,
  type TDirectScreenRetirement
} from '../direct-media';
import { getHolepunchMedia } from '../holepunch-media';

type TDirectMediaParams = {
  channelId: number | undefined;
  enabled: boolean;
  voiceOnlyMode: boolean;
  isVoiceSessionActive: boolean;
  canConsumeScreen: (userId: number) => boolean;
  onRemoteDemoStoppedRef: MutableRefObject<(userId: number) => void>;
  addRemoteUserStream: (
    userId: number,
    stream: MediaStream,
    kind: TProducibleStreamKind
  ) => void;
  removeRemoteUserStream: (
    userId: number,
    kind: TProducibleStreamKind,
    expectedStream?: MediaStream
  ) => void;
  prepareDirectScreenBundle: (
    userId: number,
    bundle: TDirectScreenBundle
  ) => Promise<void>;
  presentDirectScreenBundle: (
    userId: number,
    bundle: TDirectScreenBundle
  ) => boolean;
  retireDirectScreenBundle: (
    userId: number,
    bundle: TDirectScreenBundle,
    retirement: TDirectScreenRetirement
  ) => void;
};

type TReadyWaiter = (error?: unknown) => void;

const useDirectMedia = ({
  channelId,
  enabled,
  voiceOnlyMode,
  isVoiceSessionActive,
  canConsumeScreen,
  onRemoteDemoStoppedRef,
  addRemoteUserStream,
  removeRemoteUserStream,
  prepareDirectScreenBundle,
  presentDirectScreenBundle,
  retireDirectScreenBundle
}: TDirectMediaParams) => {
  const nativeEnabled = enabled && !!getHolepunchMedia();
  const enabledRef = useRef(nativeEnabled);
  const voiceOnlyModeRef = useRef(voiceOnlyMode);
  const sessionActiveRef = useRef(isVoiceSessionActive);
  enabledRef.current = nativeEnabled;
  voiceOnlyModeRef.current = voiceOnlyMode;
  sessionActiveRef.current = isVoiceSessionActive;
  const subscribed = useRef(false);
  const readyWaiters = useRef(new Set<TReadyWaiter>());
  const directMedia = useMemo(() => {
    const create = (kind: TDirectMediaKind) => {
      const canReceive = (userId: number) => {
        if (!enabledRef.current || !sessionActiveRef.current) return false;
        if (kind === StreamKind.AUDIO) return true;
        if (voiceOnlyModeRef.current) return false;
        return kind !== StreamKind.SCREEN || canConsumeScreen(userId);
      };
      return new DirectMedia({
        kind,
        canReceive,
        canDefer: () =>
          kind === StreamKind.SCREEN &&
          enabledRef.current &&
          sessionActiveRef.current &&
          !voiceOnlyModeRef.current,
        onStopped: (userId) => {
          if (kind === StreamKind.SCREEN)
            onRemoteDemoStoppedRef.current(userId);
        },
        prepare: async (peerId, signal) => {
          if (!enabledRef.current) return null;
          if (!subscribed.current) {
            await new Promise<void>((resolve, reject) => {
              const finish: TReadyWaiter = (error) => {
                readyWaiters.current.delete(finish);
                signal.removeEventListener('abort', abort);
                if (error !== undefined) reject(error);
                else resolve();
              };
              const abort = () =>
                finish(new DOMException('Direct media stopped', 'AbortError'));
              readyWaiters.current.add(finish);
              signal.addEventListener('abort', abort, { once: true });
              if (signal.aborted) abort();
              else if (subscribed.current) finish();
            });
          }
          if (
            signal.aborted ||
            !enabledRef.current ||
            !sessionActiveRef.current
          ) {
            throw new Error('Direct media session is no longer active');
          }
          const trpc = getTRPCClient();
          return trpc.voice.startDirectMedia.mutate({ kind, peerId });
        },
        send: async (sessionId, signal) => {
          const trpc = getTRPCClient();
          await trpc.voice.signalDirectMedia.mutate({ sessionId, signal });
        },
        onStream: (userId, stream, streamKind) => {
          if (!canReceive(userId)) {
            const tracks = stream.getTracks();
            tracks.forEach((track) => track.stop());
            return;
          }
          addRemoteUserStream(userId, stream, streamKind);
        },
        onRemoveStream: removeRemoteUserStream,
        prepareScreenBundle: prepareDirectScreenBundle,
        presentScreenBundle: presentDirectScreenBundle,
        retireScreenBundle: retireDirectScreenBundle,
        onStatus: (status) =>
          logVoice('direct media: path changed', {
            kind,
            status,
            transport: 'holepunch'
          }),
        onError: (error) =>
          logVoiceError('direct media: failed', error, { kind })
      });
    };
    return {
      [StreamKind.AUDIO]: create(StreamKind.AUDIO),
      [StreamKind.VIDEO]: create(StreamKind.VIDEO),
      [StreamKind.SCREEN]: create(StreamKind.SCREEN)
    };
  }, [
    addRemoteUserStream,
    removeRemoteUserStream,
    prepareDirectScreenBundle,
    presentDirectScreenBundle,
    retireDirectScreenBundle,
    canConsumeScreen,
    onRemoteDemoStoppedRef
  ]);

  useEffect(() => {
    if (
      !channelId ||
      !nativeEnabled ||
      !isVoiceSessionActive ||
      typeof RTCPeerConnection === 'undefined'
    )
      return;
    const trpc = getTRPCClient();
    let active = true;
    const waiters = readyWaiters.current;
    const subscription = trpc.voice.onDirectMediaSignal.subscribe(
      { enabled: true, transport: 'holepunch' },
      {
        onStarted: () => {
          if (!active) return;
          subscribed.current = true;
          readyWaiters.current.forEach((finish) => finish());
        },
        onData: (event) => {
          if (!active || !enabledRef.current || event.channelId !== channelId)
            return;
          const coordinator = directMedia[event.kind];
          if (!coordinator) return;
          coordinator.handleSignal(event).catch((error) => {
            logVoiceError('direct media: signalling failed', error);
          });
        },
        onError: (error) => {
          if (!active) return;
          subscribed.current = false;
          readyWaiters.current.forEach((finish) => finish(error));
          const coordinators = Object.values(directMedia);
          coordinators.forEach((coordinator) =>
            coordinator.close({ restoreRelay: true })
          );
          logVoiceError('direct media: subscription failed', error);
        }
      }
    );
    return () => {
      active = false;
      subscribed.current = false;
      waiters.forEach((finish) =>
        finish(new Error('Direct media subscription ended'))
      );
      subscription.unsubscribe();
      const coordinators = Object.values(directMedia);
      coordinators.forEach((coordinator) => coordinator.close());
    };
  }, [channelId, nativeEnabled, isVoiceSessionActive, directMedia]);

  useEffect(() => {
    if (!voiceOnlyMode) return;
    directMedia[StreamKind.VIDEO].close();
    directMedia[StreamKind.SCREEN].close();
  }, [voiceOnlyMode, directMedia]);

  return { directMedia };
};

export { useDirectMedia };
