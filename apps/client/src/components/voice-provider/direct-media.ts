import type {
  TDirectMediaKind,
  TProducibleStreamKind
} from '@dodecagon/shared';
import {
  DIRECT_MEDIA_AUDIO_CONNECT_TIMEOUT_MS,
  DIRECT_MEDIA_CONNECT_TIMEOUT_MS,
  StreamKind,
  type TDirectMediaEvent,
  type TDirectMediaSession,
  type TDirectMediaSignal
} from '@dodecagon/shared';
import {
  getHolepunchMedia,
  withHolepunchCandidate,
  type THolepunchMedia
} from './holepunch-media';

type TScreenKind = TProducibleStreamKind;
export type TDirectMediaResult = 'direct' | 'relay' | 'failed';
export type TDirectMediaConnection = {
  peerId: number;
  kind: TDirectMediaKind;
  direction: 'incoming' | 'outgoing';
  connection: RTCPeerConnection;
};
type TDirectMediaStatus =
  'idle' | 'connecting' | 'direct' | 'relayed' | 'failed';
type TTimerHandle = number | NodeJS.Timeout;
type TReceivedScreenStream = Readonly<{
  receiver: RTCRtpReceiver;
  stream: MediaStream;
}>;
const directScreenDelivery = Symbol('directScreenDelivery');
type TDirectScreenDeliveryEvidence = Readonly<{
  screen: TReceivedScreenStream;
  screenAudio?: TReceivedScreenStream;
}>;
export type TDirectScreenBundle = Readonly<{
  screen: MediaStream;
  screenAudio?: MediaStream;
  [directScreenDelivery]: TDirectScreenDeliveryEvidence;
}>;
export type TDirectScreenRetirement = Readonly<{
  restoreRelay: boolean;
}>;
const getRetirementSignal = (
  retirement: TDirectScreenRetirement
): TDirectMediaSignal =>
  retirement.restoreRelay ? { type: 'fallback' } : { type: 'stop' };

type TDirectMediaCallbacks = {
  kind: TDirectMediaKind;
  prepare: (
    peerId: number,
    signal: AbortSignal
  ) => Promise<TDirectMediaSession | null>;
  canReceive?: (userId: number) => boolean;
  canDefer?: () => boolean;
  onStopped?: (userId: number) => void;
  send: (sessionId: string, signal: TDirectMediaSignal) => Promise<void>;
  onStream: (userId: number, stream: MediaStream, kind: TScreenKind) => void;
  onRemoveStream: (
    userId: number,
    kind: TScreenKind,
    stream: MediaStream
  ) => void;
  prepareScreenBundle: (
    userId: number,
    bundle: TDirectScreenBundle
  ) => Promise<void>;
  presentScreenBundle: (userId: number, bundle: TDirectScreenBundle) => boolean;
  retireScreenBundle: (
    userId: number,
    bundle: TDirectScreenBundle,
    retirement: TDirectScreenRetirement
  ) => void;
  onStatus: (status: TDirectMediaStatus) => void;
  onError: (error: unknown) => void;
};

type TDirectMediaOptions = {
  maxBitrate: number;
  maxFramerate?: number;
  codec?: string;
  onFailure: (relayAllowed: boolean, peerId: number) => Promise<void>;
};

type TOutgoingAttempt = {
  controller: AbortController;
  timer: TTimerHandle;
  resolve: (result: TDirectMediaResult) => void;
  settled: boolean;
  established: boolean;
  onFailure: (relayAllowed: boolean, peerId: number) => Promise<void>;
  peerId: number;
  retirement: TDirectScreenRetirement;
  sessionId?: string;
  peer?: TDirectPeer;
};

type TDirectPeer = {
  sessionId: string;
  peerId: number;
  channelId?: number;
  senderId?: number;
  connection: RTCPeerConnection;
  controller: AbortController;
  direction: 'incoming' | 'outgoing';
  phase: 'offering' | 'offered' | 'answering' | 'answered';
  ready: boolean;
  readySending: boolean;
  streams: Map<TScreenKind, MediaStream>;
  screenReceivers: Map<
    StreamKind.SCREEN | StreamKind.SCREEN_AUDIO,
    TReceivedScreenStream
  >;
  screenAudioExpected: boolean;
  screenBundle?: TDirectScreenBundle;
  screenBundlePresented: boolean;
  deliveryChecking: boolean;
  deliveryTimer?: TTimerHandle;
  timer?: TTimerHandle;
  outgoing?: TOutgoingAttempt;
  nativeMedia?: THolepunchMedia;
  nativeEndpoint?: { publicKey: string; port: number };
  unsubscribeNative?: () => void;
};

export class DirectMedia {
  private callbacks: TDirectMediaCallbacks;
  private peers = new Map<string, TDirectPeer>();
  private pendingOffers = new Map<string, TDirectMediaEvent>();
  private retiredSessions = new Map<string, boolean>();
  private outgoing = new Map<number, TOutgoingAttempt>();
  private preparations = new Map<number, Promise<void>>();

  constructor(callbacks: TDirectMediaCallbacks) {
    this.callbacks = callbacks;
  }

  private getConnectTimeout = (): number =>
    this.callbacks.kind === StreamKind.AUDIO
      ? DIRECT_MEDIA_AUDIO_CONNECT_TIMEOUT_MS
      : DIRECT_MEDIA_CONNECT_TIMEOUT_MS;

  getConnections = (): TDirectMediaConnection[] => {
    const peers = Array.from(this.peers.values());
    const connected = peers.filter(
      (peer) => peer.connection.connectionState === 'connected'
    );
    return connected.map((peer) => ({
      peerId: peer.peerId,
      kind: this.callbacks.kind,
      direction: peer.direction,
      connection: peer.connection
    }));
  };

  startForPeer = (
    peerId: number,
    stream: MediaStream,
    options: TDirectMediaOptions
  ): Promise<TDirectMediaResult> => {
    this.stopAttempt(peerId);
    return this.startAttempt(peerId, stream, options);
  };

  stopForPeer = (peerId: number): void => {
    this.stopAttempt(peerId);
  };

  private startAttempt = (
    peerId: number,
    stream: MediaStream,
    options: TDirectMediaOptions
  ): Promise<TDirectMediaResult> => {
    return new Promise<TDirectMediaResult>((resolve) => {
      if (!getHolepunchMedia()) {
        this.callbacks.onStatus('relayed');
        resolve('relay');
        return;
      }
      const attempt: TOutgoingAttempt = {
        controller: new AbortController(),
        timer: setTimeout(() => {
          this.failOutgoing(attempt);
        }, this.getConnectTimeout()),
        resolve,
        settled: false,
        established: false,
        onFailure: options.onFailure,
        peerId,
        retirement: { restoreRelay: false }
      };
      this.outgoing.set(peerId, attempt);
      this.callbacks.onStatus('connecting');
      this.prepareOutgoing(attempt, stream, options).catch((error: unknown) => {
        if (this.isCurrentAttempt(attempt)) this.failOutgoing(attempt, error);
      });
    });
  };

  handleSignal = async (event: TDirectMediaEvent): Promise<void> => {
    if (event.transport !== 'holepunch' || event.kind !== this.callbacks.kind)
      return;
    if (this.retiredSessions.has(event.sessionId)) return;
    const peer = this.peers.get(event.sessionId);
    const pending = this.pendingOffers.get(event.sessionId);
    if (pending) {
      if (
        event.fromUserId !== pending.senderId ||
        event.senderId !== pending.senderId ||
        event.channelId !== pending.channelId
      ) {
        return;
      }
      if (event.signal.type === 'fallback' || event.signal.type === 'stop') {
        this.retirePendingOffer(pending);
        if (event.signal.type === 'stop') {
          this.callbacks.onStopped?.(pending.senderId);
        }
      }
      return;
    }

    if (!peer) {
      if (
        event.signal.type === 'offer' &&
        event.fromUserId === event.senderId
      ) {
        await this.receiveOffer(event);
      } else if (
        event.signal.type === 'fallback' ||
        event.signal.type === 'stop'
      ) {
        // terminal events can overtake the prepare RPC response or an offer.
        this.retiredSessions.set(event.sessionId, event.relayAllowed);
      }
      return;
    }

    if (!this.matchesPeer(peer, event)) return;
    const { signal } = event;
    if (signal.type === 'fallback' || signal.type === 'stop') {
      this.pinIdentity(peer, event);
      this.failPeer(peer, undefined, false, event.relayAllowed, {
        restoreRelay:
          event.relayAllowed &&
          signal.type === 'fallback' &&
          signal.reason !== 'unwatch'
      });
      if (signal.type === 'stop' && peer.direction === 'incoming') {
        this.callbacks.onStopped?.(peer.peerId);
      }
      return;
    }
    if (peer.direction !== 'outgoing') return;

    if (signal.type === 'answer' && peer.phase === 'offered') {
      this.pinIdentity(peer, event);
      peer.phase = 'answering';
      try {
        const endpoint = peer.nativeEndpoint;
        const media = peer.nativeMedia;
        if (!endpoint || !media)
          throw new Error('Native media endpoint is missing');
        await media.connect({
          sessionId: peer.sessionId,
          remotePublicKey: signal.publicKey,
          initiator: true
        });
        if (!this.isActivePeer(peer)) return;
        await peer.connection.setRemoteDescription({
          type: 'answer',
          sdp: withHolepunchCandidate(signal.sdp, endpoint.port)
        });
        if (!this.isActivePeer(peer)) return;
        peer.phase = 'answered';
        this.completeOutgoing(peer);
      } catch (error) {
        if (this.isActivePeer(peer)) this.failPeer(peer, error);
      }
    } else if (
      signal.type === 'ready' &&
      (peer.phase === 'answering' || peer.phase === 'answered')
    ) {
      this.pinIdentity(peer, event);
      peer.ready = true;
      this.completeOutgoing(peer);
    }
  };

  acceptPendingOffer = (userId: number): boolean => {
    for (const pending of this.pendingOffers.values()) {
      if (pending.senderId !== userId) continue;
      if (this.callbacks.canReceive?.(userId) === false) return false;
      this.pendingOffers.delete(pending.sessionId);
      this.receiveOffer(pending).catch((error: unknown) => {
        this.callbacks.onError(error);
      });
      return true;
    }
    return false;
  };

  stop = (
    retirement: TDirectScreenRetirement = { restoreRelay: false }
  ): void => {
    for (const attempt of [...this.outgoing.values()]) {
      this.stopAttempt(attempt.peerId, retirement);
    }
  };

  private stopAttempt = (
    peerId: number,
    retirement: TDirectScreenRetirement = { restoreRelay: false }
  ): void => {
    const key = peerId;
    const attempt = this.outgoing.get(key);
    if (!attempt) return;
    attempt.retirement = retirement;
    this.outgoing.delete(key);
    clearTimeout(attempt.timer);
    attempt.controller.abort();
    this.resolveAttempt(attempt, 'failed');
    if (attempt.peer) this.retirePeer(attempt.peer, retirement);
    if (attempt.sessionId) {
      this.retiredSessions.set(attempt.sessionId, retirement.restoreRelay);
      this.sendBestEffort(
        attempt.sessionId,
        getRetirementSignal(retirement),
        attempt.peerId
      );
    }
    if (!this.outgoing.size) this.callbacks.onStatus('idle');
  };

  stopReceiving = (userId: number): void => {
    for (const pending of this.pendingOffers.values()) {
      if (pending.senderId !== userId) continue;
      this.retirePendingOffer(pending);
      this.sendBestEffort(pending.sessionId, {
        type: 'fallback',
        reason: 'unwatch'
      });
    }
    for (const peer of this.peers.values()) {
      if (peer.direction !== 'incoming' || peer.peerId !== userId) continue;
      this.retirePeer(peer, { restoreRelay: false });
      this.sendBestEffort(peer.sessionId, {
        type: 'fallback',
        reason: 'unwatch'
      });
    }
  };

  close = (
    retirement: TDirectScreenRetirement = { restoreRelay: false }
  ): void => {
    this.stop(retirement);
    for (const pending of this.pendingOffers.values()) {
      this.retirePendingOffer(pending);
      this.sendBestEffort(pending.sessionId, getRetirementSignal(retirement));
    }
    for (const peer of this.peers.values()) {
      this.retirePeer(peer, retirement);
      this.sendBestEffort(peer.sessionId, getRetirementSignal(retirement));
    }
  };

  private setPreparationBarrier = (
    peerId: number,
    request: Promise<unknown>
  ) => {
    const pending = request.then(
      () => {},
      () => {}
    );
    this.preparations.set(peerId, pending);
    pending.finally(() => {
      if (this.preparations.get(peerId) === pending)
        this.preparations.delete(peerId);
    });
  };

  private prepareSession = (attempt: TOutgoingAttempt) => {
    const previous = this.preparations.get(attempt.peerId);
    const request = (async () => {
      if (previous) await previous;
      if (!this.isCurrentAttempt(attempt)) return null;
      const session = await this.callbacks.prepare(
        attempt.peerId,
        attempt.controller.signal
      );
      if (!this.isCurrentAttempt(attempt)) {
        if (session) {
          try {
            await this.callbacks.send(
              session.sessionId,
              getRetirementSignal(attempt.retirement)
            );
          } catch (error) {
            this.callbacks.onError(error);
          }
        }
        return null;
      }
      return session;
    })();
    this.setPreparationBarrier(attempt.peerId, request);
    return request;
  };

  private prepareOutgoing = async (
    attempt: TOutgoingAttempt,
    stream: MediaStream,
    options: TDirectMediaOptions
  ): Promise<void> => {
    const session = await this.prepareSession(attempt);
    if (!this.isCurrentAttempt(attempt)) {
      return;
    }
    if (!session) {
      this.outgoing.delete(attempt.peerId);
      clearTimeout(attempt.timer);
      attempt.controller.abort();
      this.resolveAttempt(attempt, 'relay');
      this.callbacks.onStatus('relayed');
      return;
    }
    if (
      session.transport !== 'holepunch' ||
      session.kind !== this.callbacks.kind
    ) {
      this.sendBestEffort(session.sessionId, { type: 'stop' });
      throw new Error('Direct media session kind does not match the capture');
    }
    if (this.retiredSessions.has(session.sessionId)) {
      this.sendBestEffort(session.sessionId, { type: 'stop' });
      this.failOutgoing(
        attempt,
        undefined,
        false,
        this.retiredSessions.get(session.sessionId) === true
      );
      return;
    }

    attempt.sessionId = session.sessionId;
    const connection = new RTCPeerConnection({
      iceServers: [],
      bundlePolicy: 'max-bundle'
    });
    const peer: TDirectPeer = {
      sessionId: session.sessionId,
      peerId: session.peerId,
      connection,
      controller: attempt.controller,
      direction: 'outgoing',
      phase: 'offering',
      ready: false,
      readySending: false,
      streams: new Map(),
      screenReceivers: new Map(),
      screenAudioExpected: false,
      screenBundlePresented: false,
      deliveryChecking: false,
      outgoing: attempt
    };
    attempt.peer = peer;
    this.peers.set(peer.sessionId, peer);
    this.listenForConnection(peer);
    await this.openNative(peer);
    if (!this.isActivePeer(peer)) return;

    const primary =
      this.callbacks.kind === StreamKind.AUDIO
        ? stream.getAudioTracks()[0]
        : stream.getVideoTracks()[0];
    if (!primary) throw new Error('Direct media capture has no primary track');
    const transceiver = connection.addTransceiver(primary, {
      direction: 'sendonly',
      streams: [stream],
      sendEncodings: [
        {
          maxBitrate: options.maxBitrate,
          maxFramerate: options.maxFramerate
        }
      ]
    });
    if (primary.kind === 'video') this.preferCodec(transceiver, options.codec);
    const audio = stream.getAudioTracks()[0];
    if (this.callbacks.kind === StreamKind.SCREEN && audio) {
      connection.addTransceiver(audio, {
        direction: 'sendonly',
        streams: [stream]
      });
    }

    const offer = await connection.createOffer();
    if (!this.isActivePeer(peer)) return;
    await connection.setLocalDescription(offer);
    if (!this.isActivePeer(peer)) return;
    const sdp = offer.sdp;
    if (!sdp || !peer.nativeEndpoint)
      throw new Error('Holepunch offer has no local SDP or endpoint');

    // an answer can arrive through the subscription before the send RPC returns.
    peer.phase = 'offered';
    await this.callbacks.send(peer.sessionId, {
      type: 'offer',
      sdp,
      publicKey: peer.nativeEndpoint.publicKey
    });
  };

  private receiveOffer = async (event: TDirectMediaEvent): Promise<void> => {
    if (event.signal.type !== 'offer') return;
    for (const previous of this.pendingOffers.values()) {
      if (previous.senderId !== event.senderId) continue;
      this.retirePendingOffer(previous);
      this.sendBestEffort(previous.sessionId, { type: 'stop' });
    }
    if (this.callbacks.canReceive?.(event.senderId) === false) {
      if (this.callbacks.canDefer?.() === true) {
        // the sender/server deadline remains authoritative while awaiting consent.
        this.pendingOffers.set(event.sessionId, event);
        return;
      }
      this.retiredSessions.set(event.sessionId, false);
      this.sendBestEffort(event.sessionId, { type: 'fallback' });
      return;
    }
    let peer: TDirectPeer | undefined;
    try {
      const connection = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle'
      });
      peer = {
        sessionId: event.sessionId,
        peerId: event.senderId,
        channelId: event.channelId,
        senderId: event.senderId,
        connection,
        controller: new AbortController(),
        direction: 'incoming',
        phase: 'answering',
        ready: false,
        readySending: false,
        streams: new Map(),
        screenReceivers: new Map(),
        screenAudioExpected:
          this.callbacks.kind === StreamKind.SCREEN &&
          /(?:^|\r?\n)m=audio\s+(?!0(?:\s|$))\d+/i.test(event.signal.sdp),
        screenBundlePresented: false,
        deliveryChecking: false
      };
      for (const previous of this.peers.values()) {
        if (
          previous.direction === 'incoming' &&
          previous.peerId === peer.peerId
        ) {
          this.retirePeer(previous, { restoreRelay: true });
          this.sendBestEffort(previous.sessionId, { type: 'stop' });
        }
      }
      this.peers.set(peer.sessionId, peer);
      const incoming = peer;
      peer.timer = setTimeout(() => {
        this.failPeer(incoming);
      }, this.getConnectTimeout());
      this.listenForConnection(peer);
      connection.addEventListener(
        'track',
        (trackEvent) => {
          this.receiveTrack(incoming, trackEvent.track, trackEvent.receiver);
        },
        { signal: peer.controller.signal }
      );

      await this.openNative(peer);
      if (!this.isActivePeer(peer)) return;
      const endpoint = peer.nativeEndpoint;
      const media = peer.nativeMedia;
      if (!endpoint || !media)
        throw new Error('Native media endpoint is missing');
      await media.connect({
        sessionId: peer.sessionId,
        remotePublicKey: event.signal.publicKey,
        initiator: false
      });
      if (!this.isActivePeer(peer)) return;
      await connection.setRemoteDescription({
        type: 'offer',
        sdp: withHolepunchCandidate(event.signal.sdp, endpoint.port)
      });
      if (!this.isActivePeer(peer)) return;
      const answer = await connection.createAnswer();
      if (!this.isActivePeer(peer)) return;
      await connection.setLocalDescription(answer);
      if (!this.isActivePeer(peer)) return;
      const sdp = answer.sdp;
      if (!sdp) throw new Error('Holepunch answer has no local SDP');
      await this.callbacks.send(peer.sessionId, {
        type: 'answer',
        sdp,
        publicKey: endpoint.publicKey
      });
      if (!this.isActivePeer(peer)) return;
      peer.phase = 'answered';
      this.readyIncoming(peer);
    } catch (error) {
      if (peer) {
        if (this.isActivePeer(peer)) this.failPeer(peer, error);
      } else {
        this.retiredSessions.set(event.sessionId, false);
        this.callbacks.onError(error);
        this.sendBestEffort(event.sessionId, { type: 'fallback' });
      }
    }
  };

  private preferCodec = (
    transceiver: RTCRtpTransceiver,
    codec?: string
  ): void => {
    if (
      !codec ||
      typeof transceiver.setCodecPreferences !== 'function' ||
      typeof RTCRtpReceiver === 'undefined' ||
      typeof RTCRtpReceiver.getCapabilities !== 'function'
    ) {
      return;
    }
    const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs;
    if (
      !codecs?.some(
        (supported) => supported.mimeType.toLowerCase() === codec.toLowerCase()
      )
    ) {
      return;
    }
    const preferred = codec.toLowerCase();
    transceiver.setCodecPreferences(
      [...codecs].sort((left, right) => {
        return (
          Number(right.mimeType.toLowerCase() === preferred) -
          Number(left.mimeType.toLowerCase() === preferred)
        );
      })
    );
  };

  private openNative = async (peer: TDirectPeer): Promise<void> => {
    const media = getHolepunchMedia();
    if (!media) throw new Error('Holepunch requires the native media bridge');
    peer.nativeMedia = media;
    peer.unsubscribeNative = media.onClosed(({ sessionId }) => {
      if (sessionId !== peer.sessionId || !this.isActivePeer(peer)) return;
      this.failPeer(peer, new Error('Holepunch connection ended'), true, true);
    });
    const endpoint = await media.create({ sessionId: peer.sessionId });
    if (!this.isActivePeer(peer)) {
      await media.close({ sessionId: peer.sessionId });
      return;
    }
    peer.nativeEndpoint = endpoint;
  };

  private listenForConnection = (peer: TDirectPeer): void => {
    peer.connection.addEventListener(
      'connectionstatechange',
      () => {
        if (!this.isActivePeer(peer)) return;
        switch (peer.connection.connectionState) {
          case 'connected':
            if (peer.direction === 'outgoing') this.completeOutgoing(peer);
            else this.readyIncoming(peer);
            break;
          case 'disconnected':
          case 'failed':
          case 'closed':
            this.failPeer(peer);
            break;
        }
      },
      { signal: peer.controller.signal }
    );
  };

  private receiveTrack = (
    peer: TDirectPeer,
    track: MediaStreamTrack,
    receiver: RTCRtpReceiver
  ): void => {
    if (!this.isActivePeer(peer)) return;
    let kind: TScreenKind;
    if (track.kind === 'video' && this.callbacks.kind !== StreamKind.AUDIO) {
      kind = this.callbacks.kind;
    } else if (
      track.kind === 'audio' &&
      this.callbacks.kind !== StreamKind.VIDEO
    ) {
      kind =
        this.callbacks.kind === StreamKind.AUDIO
          ? StreamKind.AUDIO
          : StreamKind.SCREEN_AUDIO;
    } else {
      track.stop();
      return;
    }
    if (peer.streams.has(kind)) return;
    try {
      const stream = new MediaStream([track]);
      peer.streams.set(kind, stream);
      if (this.callbacks.kind === StreamKind.SCREEN) {
        const screenKind = kind as StreamKind.SCREEN | StreamKind.SCREEN_AUDIO;
        peer.screenReceivers.set(screenKind, { receiver, stream });
        if (screenKind === StreamKind.SCREEN_AUDIO) {
          peer.screenAudioExpected = true;
        }
      } else {
        this.callbacks.onStream(peer.peerId, stream, kind);
      }
      this.readyIncoming(peer);
    } catch (error) {
      this.failPeer(peer, error);
    }
  };

  private readyIncoming = (peer: TDirectPeer): void => {
    if (
      !this.isActivePeer(peer) ||
      peer.phase !== 'answered' ||
      peer.readySending ||
      peer.connection.connectionState !== 'connected' ||
      !peer.streams.has(this.callbacks.kind)
    ) {
      return;
    }
    if (this.callbacks.kind === StreamKind.SCREEN) {
      if (
        peer.screenAudioExpected &&
        !peer.screenReceivers.has(StreamKind.SCREEN_AUDIO)
      ) {
        return;
      }
      this.checkScreenDelivery(peer);
      return;
    }
    peer.readySending = true;
    this.callbacks
      .send(peer.sessionId, { type: 'ready' })
      .then(() => {
        if (!this.isActivePeer(peer)) return;
        peer.ready = true;
        clearTimeout(peer.timer);
        peer.timer = undefined;
      })
      .catch((error: unknown) => {
        if (this.isActivePeer(peer)) this.failPeer(peer, error);
      });
  };

  private getScreenBundle = (
    peer: TDirectPeer
  ): TDirectScreenBundle | undefined => {
    const screen = peer.screenReceivers.get(StreamKind.SCREEN);
    if (!screen) return;
    const screenAudio = peer.screenReceivers.get(StreamKind.SCREEN_AUDIO);
    if (peer.screenAudioExpected && !screenAudio) return;
    return Object.freeze({
      screen: screen.stream,
      ...(screenAudio ? { screenAudio: screenAudio.stream } : {}),
      [directScreenDelivery]: Object.freeze({
        screen,
        ...(screenAudio ? { screenAudio } : {})
      })
    });
  };

  private receiverDelivered = async (
    receiver: RTCRtpReceiver,
    kind: StreamKind.SCREEN | StreamKind.SCREEN_AUDIO
  ): Promise<boolean> => {
    const stats = await receiver.getStats();
    const mediaKind =
      kind === StreamKind.SCREEN ? ('video' as const) : ('audio' as const);
    for (const report of stats.values()) {
      const inbound = report as RTCStats & {
        kind?: string;
        mediaType?: string;
        framesDecoded?: number;
        packetsReceived?: number;
      };
      if (
        inbound.type !== 'inbound-rtp' ||
        (inbound.kind ?? inbound.mediaType) !== mediaKind
      ) {
        continue;
      }
      return mediaKind === 'video'
        ? (inbound.framesDecoded ?? 0) > 0
        : (inbound.packetsReceived ?? 0) > 0;
    }
    return false;
  };

  private checkScreenDelivery = (peer: TDirectPeer): void => {
    if (peer.deliveryChecking || peer.readySending) return;
    clearTimeout(peer.deliveryTimer);
    peer.deliveryTimer = undefined;
    peer.deliveryChecking = true;
    const required: (StreamKind.SCREEN | StreamKind.SCREEN_AUDIO)[] = [
      StreamKind.SCREEN
    ];
    if (peer.screenAudioExpected) required.push(StreamKind.SCREEN_AUDIO);
    Promise.all(
      required.map((kind) => {
        const reception = peer.screenReceivers.get(kind);
        return reception
          ? this.receiverDelivered(reception.receiver, kind)
          : Promise.resolve(false);
      })
    )
      .then(async (delivered) => {
        peer.deliveryChecking = false;
        if (!this.isActivePeer(peer) || peer.readySending) return;
        if (delivered.some((value) => !value)) {
          peer.deliveryTimer = setTimeout(
            () => this.checkScreenDelivery(peer),
            50
          );
          return;
        }
        if (
          peer.screenAudioExpected &&
          !required.includes(StreamKind.SCREEN_AUDIO)
        ) {
          this.checkScreenDelivery(peer);
          return;
        }
        const bundle = this.getScreenBundle(peer);
        if (!bundle) return;
        peer.readySending = true;
        await this.callbacks.prepareScreenBundle(peer.peerId, bundle);
        if (
          !this.isActivePeer(peer) ||
          this.getScreenBundle(peer)?.screen !== bundle.screen ||
          this.getScreenBundle(peer)?.screenAudio !== bundle.screenAudio
        ) {
          return;
        }
        peer.screenBundle = bundle;
        peer.screenBundlePresented = true;
        if (!this.callbacks.presentScreenBundle(peer.peerId, bundle)) {
          peer.screenBundle = undefined;
          peer.screenBundlePresented = false;
          this.failPeer(peer);
          return;
        }
        if (!this.isActivePeer(peer)) return;
        await this.callbacks.send(peer.sessionId, { type: 'ready' });
        if (!this.isActivePeer(peer)) return;
        peer.ready = true;
        clearTimeout(peer.timer);
        peer.timer = undefined;
      })
      .catch((error: unknown) => {
        peer.deliveryChecking = false;
        if (this.isActivePeer(peer)) this.failPeer(peer, error);
      });
  };

  private completeOutgoing = (peer: TDirectPeer): void => {
    const attempt = peer.outgoing;
    if (
      !attempt ||
      !this.isActivePeer(peer) ||
      attempt.established ||
      peer.phase !== 'answered' ||
      !peer.ready ||
      peer.connection.connectionState !== 'connected'
    ) {
      return;
    }
    attempt.established = true;
    clearTimeout(attempt.timer);
    this.callbacks.onStatus('direct');
    this.resolveAttempt(attempt, 'direct');
  };

  private matchesPeer = (
    peer: TDirectPeer,
    event: TDirectMediaEvent
  ): boolean => {
    return (
      this.isActivePeer(peer) &&
      event.fromUserId === peer.peerId &&
      (peer.channelId === undefined || event.channelId === peer.channelId) &&
      (peer.senderId === undefined || event.senderId === peer.senderId) &&
      (peer.direction !== 'outgoing' || event.senderId !== peer.peerId)
    );
  };

  private pinIdentity = (peer: TDirectPeer, event: TDirectMediaEvent): void => {
    peer.channelId = event.channelId;
    peer.senderId = event.senderId;
  };

  private isCurrentAttempt = (attempt: TOutgoingAttempt): boolean => {
    return (
      this.outgoing.get(attempt.peerId) === attempt &&
      !attempt.controller.signal.aborted
    );
  };

  private isActivePeer = (peer: TDirectPeer): boolean => {
    if (
      this.peers.get(peer.sessionId) !== peer ||
      peer.controller.signal.aborted
    ) {
      return false;
    }
    if (
      peer.direction === 'incoming' &&
      this.callbacks.canReceive?.(peer.peerId) === false
    ) {
      this.stopReceiving(peer.peerId);
      return false;
    }
    return true;
  };

  private resolveAttempt = (
    attempt: TOutgoingAttempt,
    result: TDirectMediaResult
  ): void => {
    if (attempt.settled) return;
    attempt.settled = true;
    attempt.resolve(result);
  };

  private failPeer = (
    peer: TDirectPeer,
    error?: unknown,
    notify = true,
    relayAllowed = true,
    retirement: TDirectScreenRetirement = { restoreRelay: relayAllowed }
  ): void => {
    if (!this.isActivePeer(peer)) return;
    if (peer.outgoing) {
      this.failOutgoing(peer.outgoing, error, notify, relayAllowed);
      return;
    }
    this.retirePeer(peer, retirement);
    if (error !== undefined) this.callbacks.onError(error);
    if (notify) this.sendBestEffort(peer.sessionId, { type: 'fallback' });
  };

  private failOutgoing = (
    attempt: TOutgoingAttempt,
    error?: unknown,
    notify = true,
    relayAllowed = true
  ): void => {
    if (!this.isCurrentAttempt(attempt)) return;
    this.outgoing.delete(attempt.peerId);
    clearTimeout(attempt.timer);
    attempt.controller.abort();
    if (attempt.peer) this.retirePeer(attempt.peer, { restoreRelay: false });
    if (attempt.sessionId) {
      this.retiredSessions.set(attempt.sessionId, false);
      if (notify)
        this.sendBestEffort(
          attempt.sessionId,
          { type: 'fallback' },
          attempt.peerId
        );
    }
    this.resolveAttempt(attempt, relayAllowed ? 'relay' : 'failed');
    this.callbacks.onStatus(relayAllowed ? 'relayed' : 'failed');
    if (error !== undefined) this.callbacks.onError(error);
    if (attempt.established) {
      const peerId = attempt.peerId;
      Promise.resolve()
        .then(() => attempt.onFailure(relayAllowed, peerId))
        .catch((fallbackError: unknown) => {
          this.callbacks.onError(fallbackError);
        });
    }
  };

  private retirePendingOffer = (event: TDirectMediaEvent): void => {
    this.pendingOffers.delete(event.sessionId);
    this.retiredSessions.set(event.sessionId, false);
  };

  private retirePeer = (
    peer: TDirectPeer,
    retirement: TDirectScreenRetirement
  ): void => {
    if (this.peers.get(peer.sessionId) !== peer) return;
    this.peers.delete(peer.sessionId);
    this.retiredSessions.set(peer.sessionId, false);
    clearTimeout(peer.timer);
    clearTimeout(peer.deliveryTimer);
    peer.controller.abort();
    if (peer.screenBundlePresented && peer.screenBundle) {
      this.callbacks.retireScreenBundle(
        peer.peerId,
        peer.screenBundle,
        retirement
      );
      peer.screenBundlePresented = false;
    }
    peer.connection.close();
    peer.unsubscribeNative?.();
    if (peer.nativeMedia) {
      peer.nativeMedia
        .close({ sessionId: peer.sessionId })
        .catch((error: unknown) => {
          this.callbacks.onError(error);
        });
    }
    for (const [kind, stream] of peer.streams) {
      stream.getTracks().forEach((track) => track.stop());
      if (this.callbacks.kind !== StreamKind.SCREEN) {
        this.callbacks.onRemoveStream(peer.peerId, kind, stream);
      }
    }
    peer.streams.clear();
    peer.screenReceivers.clear();
  };

  private sendBestEffort = (
    sessionId: string,
    signal: TDirectMediaSignal,
    peerId?: number
  ): void => {
    const request = Promise.resolve()
      .then(() => this.callbacks.send(sessionId, signal))
      .catch((error: unknown) => {
        this.callbacks.onError(error);
      });
    if (peerId !== undefined)
      this.setPreparationBarrier(
        peerId,
        Promise.all([this.preparations.get(peerId), request])
      );
  };
}
