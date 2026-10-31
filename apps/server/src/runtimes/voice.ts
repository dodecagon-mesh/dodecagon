import {
  DIRECT_MEDIA_SERVER_AUDIO_CONNECT_TIMEOUT_MS,
  DIRECT_MEDIA_SERVER_CONNECT_TIMEOUT_MS,
  DIRECT_MEDIA_SERVER_NEGOTIATION_TIMEOUT_MS,
  ServerEvents,
  StreamKind,
  type TChannelState,
  type TDirectMediaEvent,
  type TDirectMediaKind,
  type TDirectMediaSession,
  type TDirectMediaSignal,
  type TExternalStreamsMap,
  type TRelayDemandEvent,
  type TRemoteProducerIds,
  type TScreenViewersSnapshot,
  type TStreamQualityLayer,
  type TTransportParams,
  type TVoiceMap,
  type TVoiceProducerInfo,
  type TVoiceUserState
} from '@dodecagon/shared';
import type {
  AppData,
  Consumer,
  Producer,
  Router,
  RouterOptions,
  WebRtcTransport
} from 'mediasoup/types';
import { config } from '../config';
import {
  buildDirectMediaDiagnostic,
  buildDirectMediaDiagnosticEvent,
  shouldReportDirectMediaDiagnostic
} from '../helpers/direct-media-diagnostics';
import { getIceServers } from '../helpers/get-ice-servers';
import { captureDiagnostic } from '../helpers/sentry';
import { logger } from '../logger';
import { eventBus } from '../plugins/event-bus';
import { invariant } from '../utils/invariant';
import {
  mediaSoupWorker,
  webRtcServer,
  webRtcServerListenInfo
} from '../utils/mediasoup';
import { pubsub } from '../utils/pubsub';

type TVoiceConnection = {
  closed: boolean;
  superseded: boolean;
};

const voiceRuntimes = new Map<number, VoiceRuntime>();

const defaultRouterOptions: RouterOptions<AppData> = {
  mediaCodecs: [
    {
      kind: 'video',
      mimeType: 'video/VP9',
      clockRate: 90000,
      parameters: {
        'profile-id': 0,
        'x-google-start-bitrate': 2000
      }
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 2000
      }
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 2000
      }
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '640032',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 2000
      }
    },
    {
      kind: 'video',
      mimeType: 'video/AV1',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 2000
      }
    },
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
      parameters: {
        useinbandfec: 1,
        usedtx: 1,
        stereo: 1,
        'sprop-stereo': 1,
        maxplaybackrate: 48000,
        maxaveragebitrate: 128000
      }
    }
  ]
};

const defaultUserState: TVoiceUserState = {
  micMuted: false,
  soundMuted: false,
  webcamEnabled: false,
  sharingScreen: false
};

type TTransportMap = {
  [userId: number]: WebRtcTransport<AppData>;
};

type TProducerMap = {
  [userId: number]: Producer<AppData>;
};

type TConsumerMap = {
  [userId: number]: {
    [streamKey: string]: Consumer<AppData>;
  };
};

type TProducerQualityLayerMap = {
  [producerKey: string]: TStreamQualityLayer[];
};

type TExternalStreamProducers = {
  audioProducer?: Producer<AppData>;
  videoProducer?: Producer<AppData>;
};

type TExternalStreamInternal = {
  title: string;
  key: string;
  pluginId: string;
  avatarUrl?: string;
  bannerUrl?: string;
  producers: TExternalStreamProducers;
};

const EXTERNAL_STREAM_ID_BASE = 1_000_000;

type TRetainedDirectMediaConsumer = Readonly<{
  kind: TRelayDemandEvent['kind'];
  consumer: Consumer<AppData>;
}>;

type TDirectMediaEndOptions = Readonly<{
  type: 'fallback' | 'stop';
  latchFailure?: boolean;
  reason?: 'unwatch';
  restoreRelay: boolean;
}>;

type TConsumerPlaybackState = 'active' | 'paused';

type TConsumerPlaybackIntent = Readonly<{
  state: TConsumerPlaybackState;
}>;

type TDirectMediaRuntimeSession = {
  kind: TDirectMediaKind;
  id: string;
  senderId: number;
  peerId: number;
  phase:
    'pending' | 'offered' | 'answered' | 'activating' | 'ready' | 'retiring';
  producerId?: string;
  deadline?: NodeJS.Timeout;
  startedAt: number;
  offeredAt?: number;
  answeredAt?: number;
  readyAt?: number;
  endReason?: 'deadline' | 'fallback' | 'stop' | 'unwatch';
  diagnosticLogged?: boolean;
  relayConsumers?: readonly TRetainedDirectMediaConsumer[];
  relayConsumerIds?: ReadonlyMap<TRelayDemandEvent['kind'], string>;
  transition?: Promise<void>;
  relayIntent?: TConsumerPlaybackState;
  retirement?: TDirectMediaEndOptions;
};

class VoiceRuntime {
  private static idleUpdateInProgress = false;

  public static beginIdleUpdate = (force = false): boolean => {
    if (
      VoiceRuntime.idleUpdateInProgress ||
      (!force &&
        [...voiceRuntimes.values()].some(
          (runtime) => runtime.state.users.length > 0
        ))
    )
      return false;
    VoiceRuntime.idleUpdateInProgress = true;
    return true;
  };

  public static endIdleUpdate = (): void => {
    VoiceRuntime.idleUpdateInProgress = false;
  };

  public readonly id: number;
  private state: TChannelState = { users: [], externalStreams: {} };
  private memberships = new Map<
    number,
    { connection: TVoiceConnection; sessionId: string }
  >();
  private router?: Router<AppData>;
  private consumerTransports: TTransportMap = {};
  private producerTransports: TTransportMap = {};
  private videoProducers: TProducerMap = {};
  private audioProducers: TProducerMap = {};
  private screenProducers: TProducerMap = {};
  private screenAudioProducers: TProducerMap = {};
  private consumers: TConsumerMap = {};
  private producerQualityLayers: TProducerQualityLayerMap = {};
  private nonVoiceMediaGenerations = new Map<number, number>();
  private nonVoiceMediaSequence = 0;
  private directMediaSubscriptions = new Map<
    number,
    { token: symbol; enabled: boolean }
  >();
  private directMediaSessions = new Map<string, TDirectMediaRuntimeSession>();
  private directMediaOutgoing = new Map<string, string>();
  private directMediaMovedMembers = new Set<number>();
  private directMediaFailedPairs = new Set<string>();
  private consumerPlaybackIntents = new WeakMap<
    Consumer<AppData>,
    TConsumerPlaybackIntent
  >();
  private consumerPlaybackOperations = new WeakMap<
    Consumer<AppData>,
    Promise<void>
  >();
  private destroyed = false;

  private externalCounter = EXTERNAL_STREAM_ID_BASE;
  private externalStreamsInternal: {
    [streamId: number]: TExternalStreamInternal;
  } = {};

  constructor(channelId: number) {
    this.id = channelId;
    voiceRuntimes.set(channelId, this);
  }

  public static findById = (channelId: number): VoiceRuntime | undefined => {
    return voiceRuntimes.get(channelId);
  };

  public static findRuntimeByUserId = (
    userId: number
  ): VoiceRuntime | undefined => {
    for (const runtime of voiceRuntimes.values()) {
      if (runtime.getUser(userId)) {
        return runtime;
      }
    }

    return undefined;
  };

  // a runtime a test forgot to destroy still holds its members, and
  // findRuntimeByUserId would answer with it for a user another test put in a
  // fresh channel. the suite starts every test from an empty registry instead
  public static clearRegistryForTests = (): void => {
    voiceRuntimes.clear();
  };

  public static getVoiceMap = (): TVoiceMap => {
    const map: TVoiceMap = {};

    voiceRuntimes.forEach((runtime, channelId) => {
      map[channelId] = {
        users: {}
      };

      runtime.getState().users.forEach((user) => {
        if (!map[channelId]) {
          map[channelId] = { users: {} };
        }

        map[channelId].users[user.userId] = user.state;
      });
    });

    return map;
  };

  public static getExternalStreamsMap = (): TExternalStreamsMap => {
    const map: TExternalStreamsMap = {};

    voiceRuntimes.forEach((runtime, channelId) => {
      if (map[channelId]) {
        map[channelId] = [];
      }

      map[channelId] = runtime.getState().externalStreams;
    });

    return map;
  };

  private getConsumerKey = (remoteId: number, kind: StreamKind) => {
    return `${remoteId}-${kind}`;
  };

  private getProducerKey = (remoteId: number, kind: StreamKind) => {
    return `${remoteId}-${kind}`;
  };

  private validateProducerQualityLayers = (
    producer: Producer<AppData> | undefined,
    qualityLayers?: TStreamQualityLayer[]
  ): TStreamQualityLayer[] => {
    if (!producer || producer.kind !== 'video') {
      if (qualityLayers !== undefined) {
        throw new Error('Quality layers can only be set for video producers');
      }

      return [];
    }

    if (producer.type !== 'simulcast') {
      if (qualityLayers !== undefined) {
        throw new Error(
          'Quality layers can only be set for simulcast producers'
        );
      }

      return [];
    }

    const expectedLayerCount = producer.rtpParameters.encodings?.length ?? 0;

    if (!qualityLayers?.length) {
      throw new Error('Simulcast video producers require quality layer labels');
    }

    if (qualityLayers.length !== expectedLayerCount) {
      throw new Error(
        'Quality layer count must match simulcast encoding count'
      );
    }

    const seenLayers = new Set<number>();
    const normalizedLayers = qualityLayers.map((layer) => {
      const label = layer.label.trim();

      if (!label) {
        throw new Error('Quality layer labels cannot be empty');
      }

      if (!Number.isInteger(layer.spatialLayer) || layer.spatialLayer < 0) {
        throw new Error(
          'Quality layer spatialLayer must be a non-negative integer'
        );
      }

      if (seenLayers.has(layer.spatialLayer)) {
        throw new Error('Quality layer spatialLayer values must be unique');
      }

      seenLayers.add(layer.spatialLayer);

      return {
        spatialLayer: layer.spatialLayer,
        label
      };
    });

    for (let layer = 0; layer < expectedLayerCount; layer++) {
      if (!seenLayers.has(layer)) {
        throw new Error(
          'Quality layer spatialLayer values must match encoding indexes'
        );
      }
    }

    return normalizedLayers.sort((a, b) => a.spatialLayer - b.spatialLayer);
  };

  private setProducerQualityLayers = (
    remoteId: number,
    kind: StreamKind,
    layers: TStreamQualityLayer[]
  ) => {
    const producerKey = this.getProducerKey(remoteId, kind);

    if (layers.length === 0) {
      delete this.producerQualityLayers[producerKey];
      return;
    }

    this.producerQualityLayers[producerKey] = layers;
  };

  public init = async (): Promise<void> => {
    logger.debug(`Initializing voice runtime for channel ${this.id}`);

    await this.createRouter();

    eventBus.emit('voice:runtime_initialized', {
      channelId: this.id
    });
  };

  public destroy = async () => {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.endAllDirectMediaSessions('stop', false);
    this.directMediaSubscriptions.clear();
    this.directMediaMovedMembers.clear();
    this.directMediaFailedPairs.clear();
    this.nonVoiceMediaGenerations.clear();
    await this.router?.close();

    Object.values(this.consumerTransports).forEach((transport) => {
      transport.close();
    });

    Object.values(this.producerTransports).forEach((transport) => {
      transport.close();
    });

    Object.values(this.videoProducers).forEach((producer) => {
      producer.close();
    });

    Object.values(this.screenProducers).forEach((producer) => {
      producer.close();
    });

    Object.values(this.screenAudioProducers).forEach((producer) => {
      producer.close();
    });

    Object.values(this.audioProducers).forEach((producer) => {
      producer.close();
    });

    Object.values(this.externalStreamsInternal).forEach((stream) => {
      if (
        stream.producers.videoProducer &&
        !stream.producers.videoProducer.closed
      ) {
        stream.producers.videoProducer.close();
      }
      if (
        stream.producers.audioProducer &&
        !stream.producers.audioProducer.closed
      ) {
        stream.producers.audioProducer.close();
      }
    });

    Object.values(this.consumers).forEach((consumers) => {
      Object.values(consumers).forEach((consumer) => {
        consumer.close();
      });
    });

    const remainingUsers = this.state.users;

    this.state.users = [];

    remainingUsers.forEach(({ userId }) => {
      const sessionId = this.getSessionId(userId)!;
      this.memberships.delete(userId);
      pubsub.publish(ServerEvents.USER_LEAVE_VOICE, {
        channelId: this.id,
        userId,
        sessionId
      });

      eventBus.emit('user:left_voice', {
        userId,
        channelId: this.id
      });
    });

    // a runtime that a channel replaced must not unregister its successor, or
    // the channel would lose the runtime every later lookup resolves
    if (voiceRuntimes.get(this.id) === this) voiceRuntimes.delete(this.id);
    this.publishScreenViewers();

    eventBus.emit('voice:runtime_closed', {
      channelId: this.id
    });
  };

  public getState = (): TChannelState => {
    return this.state;
  };

  public getUser = (userId: number) => {
    return this.state.users.find((u) => u.userId === userId);
  };

  public getUserState = (userId: number): TVoiceUserState => {
    const user = this.getUser(userId);

    return user?.state ?? defaultUserState;
  };

  public ownsUser = (userId: number, connection: TVoiceConnection) =>
    !connection.closed &&
    !connection.superseded &&
    this.memberships.get(userId)?.connection === connection;

  public getSessionId = (userId: number) =>
    this.memberships.get(userId)?.sessionId;

  public supersedeUser = (userId: number) => {
    const membership = this.memberships.get(userId);
    if (membership) membership.connection.superseded = true;
  };

  public assertCanJoin = () => {
    invariant(!this.destroyed && !VoiceRuntime.idleUpdateInProgress, {
      code: 'CONFLICT',
      message:
        'The server is installing an update. Retry joining voice shortly.'
    });
  };

  public addUser = (
    userId: number,
    state: Pick<TVoiceUserState, 'micMuted' | 'soundMuted'>,
    connection: TVoiceConnection,
    sessionId: string = crypto.randomUUID()
  ) => {
    this.assertCanJoin();
    invariant(!connection.closed && !connection.superseded, {
      code: 'CONFLICT',
      message: 'This voice connection is no longer active'
    });
    invariant(!this.getUser(userId), {
      code: 'CONFLICT',
      message: 'User already in a voice channel'
    });
    this.memberships.set(userId, { connection, sessionId });

    this.clearDirectMediaFailures(userId);
    this.nonVoiceMediaGenerations.set(userId, ++this.nonVoiceMediaSequence);
    this.state.users.push({
      userId,
      state: {
        ...defaultUserState,
        ...state
      }
    });

    eventBus.emit('user:joined_voice', {
      userId: userId,
      channelId: this.id
    });
  };

  public removeUser = (userId: number) => {
    if (!this.getUser(userId)) return;
    this.memberships.delete(userId);
    this.nonVoiceMediaGenerations.delete(userId);
    this.invalidateDirectMediaUser(userId);
    this.state.users = this.state.users.filter((u) => u.userId !== userId);
    this.directMediaMovedMembers.delete(userId);
    this.clearDirectMediaFailures(userId);

    this.cleanupUserResources(userId);
    this.publishScreenViewers();

    eventBus.emit('user:left_voice', {
      userId: userId,
      channelId: this.id
    });
  };

  private cleanupUserResources = (userId: number) => {
    this.removeProducerTransport(userId);
    this.removeConsumerTransport(userId);

    this.removeProducer(userId, StreamKind.AUDIO);
    this.removeProducer(userId, StreamKind.VIDEO);
    this.removeProducer(userId, StreamKind.SCREEN);
    this.removeProducer(userId, StreamKind.SCREEN_AUDIO);

    if (this.consumers[userId]) {
      Object.values(this.consumers[userId]).forEach((consumer) => {
        consumer.close();
      });

      delete this.consumers[userId];
    }

    Object.keys(this.consumers).forEach((consumerUserIdStr) => {
      const consumerId = parseInt(consumerUserIdStr);

      if (consumerId === userId) return;

      const userConsumers = this.consumers[consumerId];

      Object.keys(userConsumers ?? {}).forEach((streamKey) => {
        if (!userConsumers) return;
        if (!streamKey.startsWith(`${userId}-`)) return;

        userConsumers[streamKey]?.close();

        delete userConsumers[streamKey];
      });
    });
  };

  public getConsumer = (userId: number, remoteId: number, kind: StreamKind) => {
    return this.consumers[userId]?.[this.getConsumerKey(remoteId, kind)];
  };

  public applyConsumerPlaybackState = async (
    userId: number,
    remoteId: number,
    kind: StreamKind,
    consumer: Consumer<AppData>,
    state: TConsumerPlaybackState
  ): Promise<boolean> => {
    const intent: TConsumerPlaybackIntent = { state };
    this.consumerPlaybackIntents.set(consumer, intent);
    const pendingSession = this.getDirectMediaRelaySession(
      remoteId,
      userId,
      kind
    );
    if (pendingSession) pendingSession.relayIntent = state;
    const previous = this.consumerPlaybackOperations.get(consumer);
    let applied = false;
    const operation = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (this.consumerPlaybackIntents.get(consumer) !== intent) return;
        const session = this.getDirectMediaRelaySession(remoteId, userId, kind);
        if (
          session &&
          (state === 'paused' ||
            session.phase === 'activating' ||
            session.phase === 'ready' ||
            session.phase === 'retiring')
        ) {
          session.relayIntent = state;
          await this.endDirectMediaSession(
            session,
            state === 'active'
              ? { type: 'fallback', restoreRelay: true }
              : {
                  type: 'fallback',
                  reason: 'unwatch',
                  restoreRelay: false
                }
          );
        }
        if (this.consumerPlaybackIntents.get(consumer) !== intent) return;
        const current = this.getConsumer(userId, remoteId, kind);
        if (current !== consumer || consumer.closed) return;
        try {
          if (state === 'paused' && !consumer.paused) {
            await consumer.pause();
          } else if (state === 'active' && consumer.paused) {
            await consumer.resume();
          }
        } catch (error) {
          if (
            this.getConsumer(userId, remoteId, kind) !== consumer ||
            consumer.closed
          ) {
            return;
          }
          throw error;
        }
        if (this.consumerPlaybackIntents.get(consumer) !== intent) return;
        applied =
          this.getConsumer(userId, remoteId, kind) === consumer &&
          !consumer.closed;
      });
    this.consumerPlaybackOperations.set(consumer, operation);
    try {
      await operation;
    } finally {
      if (this.consumerPlaybackOperations.get(consumer) === operation) {
        this.consumerPlaybackOperations.delete(consumer);
      }
    }
    return applied;
  };

  public getConsumerById = (userId: number, consumerId: string) => {
    const userConsumers = this.consumers[userId];

    if (!userConsumers) return undefined;

    return Object.values(userConsumers).find(
      (consumer) => consumer.id === consumerId
    );
  };

  public getNonVoiceMediaGeneration = (userId: number) => {
    return this.nonVoiceMediaGenerations.get(userId) ?? 0;
  };

  public assertMediaAllowed = (
    userId: number,
    kind: StreamKind,
    generation?: number
  ) => {
    invariant(
      kind === StreamKind.AUDIO ||
        (!this.destroyed &&
          this.nonVoiceMediaGenerations.has(userId) &&
          !this.getUserState(userId).voiceOnlyMode &&
          (generation === undefined ||
            generation === this.getNonVoiceMediaGeneration(userId))),
      {
        code: 'FORBIDDEN',
        message: 'Voice-only mode does not allow this media'
      }
    );
  };

  public updateUserState = (
    userId: number,
    newState: Partial<TChannelState['users'][0]['state']>
  ) => {
    const user = this.getUser(userId);

    if (!user) return;
    const voiceOnlyMode = newState.voiceOnlyMode ?? user.state.voiceOnlyMode;
    user.state = {
      ...user.state,
      ...newState,
      ...(voiceOnlyMode === undefined ? {} : { voiceOnlyMode }),
      ...(voiceOnlyMode ? { webcamEnabled: false, sharingScreen: false } : {})
    };
    if (voiceOnlyMode) {
      this.nonVoiceMediaGenerations.set(userId, ++this.nonVoiceMediaSequence);
      this.endDirectMediaSessionsForUser(userId, true, false);
      this.removeProducer(userId, StreamKind.VIDEO);
      this.removeProducer(userId, StreamKind.SCREEN);
      this.removeProducer(userId, StreamKind.SCREEN_AUDIO);
      const consumers = this.consumers[userId];
      for (const streamKey in consumers) {
        if (streamKey.slice(streamKey.indexOf('-') + 1) === StreamKind.AUDIO)
          continue;
        consumers[streamKey]?.close();
        delete consumers[streamKey];
      }
      this.publishScreenViewers();
    }
    if (newState.sharingScreen === false) {
      for (const session of this.directMediaSessions.values()) {
        if (session.senderId !== userId || session.kind !== StreamKind.SCREEN)
          continue;
        session.endReason = 'stop';
        void this.endDirectMediaSession(session, {
          type: 'stop',
          restoreRelay: false
        });
      }
    }
  };

  private publishDirectMediaCapability = (userId: number, enabled: boolean) => {
    const user = this.getUser(userId);
    if (!user || user.state.directMediaEnabled === enabled) return;
    user.state = { ...user.state, directMediaEnabled: enabled };
    pubsub.publish(ServerEvents.USER_VOICE_STATE_UPDATE, {
      channelId: this.id,
      userId,
      state: user.state
    });
  };

  public registerDirectMediaSubscriber = (userId: number, enabled: boolean) => {
    const token = Symbol();
    if (
      this.destroyed ||
      this.directMediaMovedMembers.has(userId) ||
      !this.getUser(userId)
    ) {
      return { unregister: () => {}, isCurrent: () => false };
    }
    const effectiveEnabled = enabled && config.webRtc.holepunchMediaEnabled;
    this.directMediaSubscriptions.set(userId, {
      token,
      enabled: effectiveEnabled
    });
    this.publishDirectMediaCapability(userId, effectiveEnabled);
    if (!effectiveEnabled) this.endDirectMediaSessionsForUser(userId);
    return {
      isCurrent: () =>
        this.directMediaSubscriptions.get(userId)?.token === token,
      unregister: () => {
        if (this.directMediaSubscriptions.get(userId)?.token !== token) return;
        this.directMediaSubscriptions.delete(userId);
        this.publishDirectMediaCapability(userId, false);
        this.endDirectMediaSessionsForUser(userId);
      }
    };
  };

  public hasDirectMediaCapability = (
    userId: number,
    kind: TDirectMediaKind
  ) => {
    return (
      config.webRtc.holepunchMediaEnabled &&
      !this.destroyed &&
      !this.directMediaMovedMembers.has(userId) &&
      !!this.getUser(userId) &&
      (kind === StreamKind.AUDIO || !this.getUserState(userId).voiceOnlyMode) &&
      this.directMediaSubscriptions.get(userId)?.enabled === true
    );
  };

  public invalidateDirectMediaUser = (
    userId: number,
    blockUntilRejoin = false
  ) => {
    if (blockUntilRejoin && this.getUser(userId))
      this.directMediaMovedMembers.add(userId);
    this.directMediaSubscriptions.delete(userId);
    this.publishDirectMediaCapability(userId, false);
    this.endDirectMediaSessionsForUser(userId, false, false);
  };

  private canStartDirectMediaPair = (
    senderId: number,
    peerId: number,
    kind: TDirectMediaKind
  ) => {
    if (senderId === peerId) return false;
    if (!this.getUser(senderId) || !this.getUser(peerId)) return false;
    if (
      !this.hasDirectMediaCapability(senderId, kind) ||
      !this.hasDirectMediaCapability(peerId, kind)
    )
      return false;
    return !this.directMediaFailedPairs.has(
      this.getDirectMediaOutgoingKey(senderId, kind, peerId)
    );
  };

  private getDirectMediaOutgoingKey = (
    senderId: number,
    kind: TDirectMediaKind,
    peerId: number
  ) => `${senderId}-${kind}-${peerId}`;

  private armDirectMediaDeadline = (
    session: TDirectMediaRuntimeSession,
    timeout: number
  ): void => {
    clearTimeout(session.deadline);
    session.deadline = setTimeout(() => {
      if (this.directMediaSessions.get(session.id) !== session) return;
      session.endReason = 'deadline';
      void this.endDirectMediaSession(session, {
        type: 'fallback',
        latchFailure: true,
        restoreRelay: true
      });
    }, timeout);
    session.deadline.unref();
  };

  public startDirectMedia = (
    senderId: number,
    kind: TDirectMediaKind,
    peerId: number
  ): TDirectMediaSession | null => {
    if (!config.webRtc.holepunchMediaEnabled) return null;
    const peer = this.getUser(peerId);
    if (!peer) return null;
    const outgoingKey = this.getDirectMediaOutgoingKey(
      senderId,
      kind,
      peer.userId
    );
    if (this.directMediaFailedPairs.has(outgoingKey)) {
      logger.info(
        'direct-media-declined %s',
        JSON.stringify({ kind, reason: 'latched' })
      );
      return null;
    }
    if (!this.canStartDirectMediaPair(senderId, peer.userId, kind)) return null;
    if (this.directMediaOutgoing.has(outgoingKey)) {
      logger.info(
        'direct-media-declined %s',
        JSON.stringify({ kind, reason: 'in_flight' })
      );
      return null;
    }
    const session: TDirectMediaRuntimeSession = {
      kind,
      id: crypto.randomUUID(),
      senderId,
      peerId: peer.userId,
      producerId: this.getProducer(kind, senderId)?.id,
      phase: 'pending',
      startedAt: Date.now()
    };
    if (kind === StreamKind.SCREEN) {
      this.updateDirectMediaRelayConsumers(
        session,
        this.captureDirectMediaRelayConsumers(senderId, peer.userId, kind)
      );
    }
    this.armDirectMediaDeadline(
      session,
      DIRECT_MEDIA_SERVER_NEGOTIATION_TIMEOUT_MS
    );
    this.directMediaSessions.set(session.id, session);
    this.directMediaOutgoing.set(outgoingKey, session.id);
    return {
      sessionId: session.id,
      kind: session.kind,
      peerId: session.peerId,
      transport: 'holepunch'
    };
  };

  public getDirectMediaSession = (
    sessionId: string,
    userId: number,
    includeRetiring = false
  ) => {
    const session = this.directMediaSessions.get(sessionId);
    return session &&
      (includeRetiring || session.phase !== 'retiring') &&
      (session.senderId === userId || session.peerId === userId)
      ? session
      : undefined;
  };

  public signalDirectMedia = async (
    sessionId: string,
    userId: number,
    signal: TDirectMediaSignal
  ): Promise<void> => {
    if (
      (signal.type === 'fallback' || signal.type === 'stop') &&
      !this.directMediaSessions.has(sessionId)
    )
      return;
    const retiring = this.directMediaSessions.get(sessionId);
    if (
      (signal.type === 'fallback' || signal.type === 'stop') &&
      retiring?.phase === 'retiring'
    ) {
      const unwatch =
        signal.type === 'fallback' &&
        signal.reason === 'unwatch' &&
        userId === retiring.peerId;
      if (unwatch) {
        retiring.endReason = 'unwatch';
        await this.endDirectMediaSession(retiring, {
          type: 'fallback',
          reason: 'unwatch',
          restoreRelay: false
        });
      } else {
        await retiring.transition;
      }
      return;
    }
    const session = this.getDirectMediaSession(sessionId, userId);
    invariant(session, {
      code: 'NOT_FOUND',
      message: 'Direct screen session not found'
    });
    if (signal.type === 'fallback' || signal.type === 'stop') {
      const unwatch = signal.type === 'fallback' && signal.reason === 'unwatch';
      invariant(!unwatch || userId === session.peerId, {
        code: 'FORBIDDEN',
        message: 'Only the receiver can cancel watching'
      });
      session.endReason = unwatch
        ? 'unwatch'
        : signal.type === 'stop'
          ? 'stop'
          : 'fallback';
      await this.endDirectMediaSession(session, {
        type: signal.type,
        latchFailure: signal.type === 'fallback' && !unwatch,
        reason: unwatch ? 'unwatch' : undefined,
        restoreRelay: !unwatch
      });
      return;
    }
    invariant(config.webRtc.holepunchMediaEnabled && !this.destroyed, {
      code: 'BAD_REQUEST',
      message: 'Holepunch media is disabled'
    });
    invariant(
      this.canStartDirectMediaPair(
        session.senderId,
        session.peerId,
        session.kind
      ),
      {
        code: 'NOT_FOUND',
        message: 'Direct screen session not found'
      }
    );
    if (signal.type === 'offer') {
      invariant(userId === session.senderId && session.phase === 'pending', {
        code: 'BAD_REQUEST',
        message: 'Unexpected direct screen offer'
      });
      session.phase = 'offered';
      session.offeredAt = Date.now();
    } else if (signal.type === 'answer') {
      invariant(userId === session.peerId && session.phase === 'offered', {
        code: 'BAD_REQUEST',
        message: 'Unexpected direct screen answer'
      });
      session.phase = 'answered';
      session.answeredAt = Date.now();
      this.armDirectMediaDeadline(
        session,
        session.kind === StreamKind.AUDIO
          ? DIRECT_MEDIA_SERVER_AUDIO_CONNECT_TIMEOUT_MS
          : DIRECT_MEDIA_SERVER_CONNECT_TIMEOUT_MS
      );
    } else {
      invariant(userId === session.peerId && session.phase === 'answered', {
        code: 'BAD_REQUEST',
        message: 'Unexpected direct screen ready signal'
      });
      await this.activateDirectMediaSession(session);
      const active = this.directMediaSessions.get(session.id);
      if (active !== session || active.phase !== 'ready') return;
      session.readyAt = Date.now();
    }
    this.publishRelayDemand(session.senderId);
    if (signal.type === 'ready') this.publishScreenViewers();
    this.publishDirectMediaSignal(session, userId, signal, [
      userId === session.senderId ? session.peerId : session.senderId
    ]);
  };

  private publishDirectMediaSignal = (
    session: TDirectMediaRuntimeSession,
    fromUserId: number,
    signal: TDirectMediaSignal,
    recipients: number[]
  ) => {
    const event: TDirectMediaEvent = {
      kind: session.kind,
      // direct media is only an attempt: relay is always a valid destination.
      relayAllowed: true,
      sessionId: session.id,
      channelId: this.id,
      senderId: session.senderId,
      fromUserId,
      transport: 'holepunch',
      signal
    };
    pubsub.publishFor(recipients, ServerEvents.DIRECT_MEDIA_SIGNAL, event);
  };

  private getDirectMediaRetirement = (
    session: TDirectMediaRuntimeSession,
    fallback: TDirectMediaEndOptions
  ): TDirectMediaEndOptions => {
    const retirement = session.retirement ?? fallback;
    if (retirement.type === 'stop') return retirement;
    if (session.relayIntent === 'paused') {
      return {
        type: 'fallback',
        ...(retirement.latchFailure ? { latchFailure: true } : {}),
        reason: 'unwatch',
        restoreRelay: false
      };
    }
    if (session.relayIntent === 'active') {
      return {
        type: 'fallback',
        ...(retirement.latchFailure ? { latchFailure: true } : {}),
        restoreRelay: true
      };
    }
    return retirement;
  };

  private discardDirectMediaRelayConsumer = (
    session: TDirectMediaRuntimeSession,
    kind: TRelayDemandEvent['kind'],
    consumer: Consumer<AppData>
  ): boolean => {
    const key = this.getConsumerKey(session.senderId, kind);
    const current = this.consumers[session.peerId]?.[key];
    if (current && current !== consumer && !current.closed) return false;
    if (current === consumer) {
      if (!consumer.closed) consumer.close();
      if (this.consumers[session.peerId]?.[key] === consumer) {
        delete this.consumers[session.peerId]?.[key];
      }
    }
    const remaining = this.consumers[session.peerId]?.[key];
    return !remaining || remaining.closed;
  };

  private endDirectMediaSession = (
    session: TDirectMediaRuntimeSession,
    options: TDirectMediaEndOptions
  ): Promise<void> => {
    if (this.directMediaSessions.get(session.id) !== session)
      return Promise.resolve();
    if (options.type === 'stop') {
      session.relayIntent = undefined;
    } else if (options.reason === 'unwatch') {
      session.relayIntent = 'paused';
    }
    const latchFailure =
      session.retirement?.latchFailure === true ||
      options.latchFailure === true;
    session.retirement = {
      ...options,
      ...(latchFailure ? { latchFailure: true } : {})
    };
    if (!session.diagnosticLogged) {
      session.diagnosticLogged = true;
      const diagnostic = buildDirectMediaDiagnostic({
        sessionId: session.id,
        kind: session.kind,
        startedAt: session.startedAt,
        ...(session.offeredAt !== undefined
          ? { offeredAt: session.offeredAt }
          : {}),
        ...(session.answeredAt !== undefined
          ? { answeredAt: session.answeredAt }
          : {}),
        ...(session.readyAt !== undefined ? { readyAt: session.readyAt } : {}),
        endedAt: Date.now(),
        reason:
          session.endReason ??
          (options.reason === 'unwatch'
            ? 'unwatch'
            : options.type === 'stop'
              ? 'stop'
              : 'fallback'),
        latched: latchFailure,
        relayRestore: options.restoreRelay
      });
      logger.info('direct-media %s', JSON.stringify(diagnostic));
      if (shouldReportDirectMediaDiagnostic(diagnostic))
        captureDiagnostic(buildDirectMediaDiagnosticEvent(diagnostic));
    }
    if (session.phase === 'retiring') {
      return session.transition ?? Promise.resolve();
    }
    const previousTransition = session.transition;
    session.phase = 'retiring';
    clearTimeout(session.deadline);
    session.deadline = undefined;
    const transition = (async () => {
      if (previousTransition) await previousTransition.catch(() => {});
      if (
        this.directMediaSessions.get(session.id) !== session ||
        session.phase !== 'retiring'
      ) {
        return;
      }
      const shouldRestoreRelay = () =>
        this.getDirectMediaRetirement(session, options).restoreRelay &&
        this.canRestoreDirectMediaRelay(session);
      const restoreRelay = shouldRestoreRelay();
      const missingConsumers = new Map<
        TRelayDemandEvent['kind'],
        string | undefined
      >();
      if (session.kind === StreamKind.SCREEN && restoreRelay) {
        for (const kind of this.getDirectMediaRelayKinds(session.kind)) {
          const key = this.getConsumerKey(session.senderId, kind);
          const current = this.consumers[session.peerId]?.[key];
          const retained = session.relayConsumers?.find(
            (entry) => entry.kind === kind
          )?.consumer;
          if (!current || current.closed) {
            missingConsumers.set(
              kind,
              current?.id ?? retained?.id ?? session.relayConsumerIds?.get(kind)
            );
            continue;
          }
          if (current !== retained || !current.paused) continue;
          try {
            await current.resume();
          } catch {
            if (this.discardDirectMediaRelayConsumer(session, kind, current)) {
              missingConsumers.set(kind, current.id);
            }
            continue;
          }
          if (
            this.directMediaSessions.get(session.id) !== session ||
            session.phase !== 'retiring'
          ) {
            return;
          }
          const resumed = this.consumers[session.peerId]?.[key];
          if (resumed !== current || current.closed) {
            if (!resumed || resumed.closed) {
              missingConsumers.set(kind, current.id);
            }
            continue;
          }
          if (!shouldRestoreRelay()) {
            try {
              await current.pause();
            } catch {
              if (
                this.discardDirectMediaRelayConsumer(session, kind, current)
              ) {
                missingConsumers.set(kind, current.id);
              }
              continue;
            }
            if (
              this.directMediaSessions.get(session.id) !== session ||
              session.phase !== 'retiring'
            ) {
              return;
            }
            const paused = this.consumers[session.peerId]?.[key];
            if (paused !== current || current.closed) {
              if (!paused || paused.closed) {
                missingConsumers.set(kind, current.id);
              }
            }
          }
        }
      } else if (restoreRelay) {
        for (const kind of this.getDirectMediaRelayKinds(session.kind)) {
          const key = this.getConsumerKey(session.senderId, kind);
          const current = this.consumers[session.peerId]?.[key];
          if (!current || current.closed) {
            missingConsumers.set(kind, current?.id);
          }
        }
      }
      if (
        this.directMediaSessions.get(session.id) !== session ||
        session.phase !== 'retiring'
      ) {
        return;
      }
      this.directMediaSessions.delete(session.id);
      this.directMediaOutgoing.delete(
        this.getDirectMediaOutgoingKey(
          session.senderId,
          session.kind,
          session.peerId
        )
      );
      const retirement = this.getDirectMediaRetirement(session, options);
      if (retirement.latchFailure) {
        this.directMediaFailedPairs.add(
          this.getDirectMediaOutgoingKey(
            session.senderId,
            session.kind,
            session.peerId
          )
        );
      }
      if (shouldRestoreRelay()) {
        for (const kind of this.getDirectMediaRelayKinds(session.kind)) {
          const current =
            this.consumers[session.peerId]?.[
              this.getConsumerKey(session.senderId, kind)
            ];
          if (!current || current.closed) {
            missingConsumers.set(
              kind,
              current?.id ??
                session.relayConsumerIds?.get(kind) ??
                missingConsumers.get(kind)
            );
          }
        }
      }
      const signal: TDirectMediaSignal =
        retirement.type === 'fallback'
          ? {
              type: retirement.type,
              ...(retirement.reason ? { reason: retirement.reason } : {})
            }
          : { type: retirement.type };
      this.publishDirectMediaSignal(session, session.peerId, signal, [
        session.senderId
      ]);
      this.publishDirectMediaSignal(session, session.senderId, signal, [
        session.peerId
      ]);
      if (shouldRestoreRelay()) {
        for (const [kind, replaceConsumerId] of missingConsumers) {
          if (!this.getProducer(kind, session.senderId)) continue;
          pubsub.publishFor([session.peerId], ServerEvents.VOICE_NEW_PRODUCER, {
            channelId: this.id,
            remoteId: session.senderId,
            kind,
            ...(replaceConsumerId ? { replaceConsumerId } : {})
          });
        }
      }
      this.publishRelayDemand(session.senderId);
      this.publishScreenViewers();
    })();
    session.transition = transition;
    return transition;
  };

  private endDirectMediaSessionsForUser = (
    userId: number,
    nonVoiceOnly = false,
    restoreRelay = true
  ) => {
    for (const session of this.directMediaSessions.values()) {
      if (nonVoiceOnly && session.kind === StreamKind.AUDIO) continue;
      if (session.senderId === userId || session.peerId === userId) {
        session.endReason = 'stop';
        void this.endDirectMediaSession(session, {
          type: 'fallback',
          restoreRelay
        });
      }
    }
  };

  private endAllDirectMediaSessions = (
    type: 'fallback' | 'stop',
    restoreRelay: boolean
  ) =>
    Promise.all(
      [...this.directMediaSessions.values()].map((session) => {
        session.endReason = 'stop';
        return this.endDirectMediaSession(session, { type, restoreRelay });
      })
    );

  private getDirectMediaRelayKinds = (
    kind: TDirectMediaKind
  ): TRelayDemandEvent['kind'][] =>
    kind === StreamKind.SCREEN
      ? [StreamKind.SCREEN, StreamKind.SCREEN_AUDIO]
      : [kind];

  private captureDirectMediaRelayConsumers = (
    senderId: number,
    peerId: number,
    kind: TDirectMediaKind
  ): readonly TRetainedDirectMediaConsumer[] =>
    Object.freeze(
      this.getDirectMediaRelayKinds(kind).flatMap(
        (relayKind): TRetainedDirectMediaConsumer[] => {
          const consumer =
            this.consumers[peerId]?.[this.getConsumerKey(senderId, relayKind)];
          return consumer && !consumer.closed
            ? [{ kind: relayKind, consumer }]
            : [];
        }
      )
    );

  private updateDirectMediaRelayConsumers = (
    session: TDirectMediaRuntimeSession,
    consumers: readonly TRetainedDirectMediaConsumer[]
  ) => {
    const consumerIds = new Map(session.relayConsumerIds);
    for (const { kind, consumer } of consumers) {
      consumerIds.set(kind, consumer.id);
    }
    session.relayConsumerIds = consumerIds;
    session.relayConsumers = consumers;
  };

  private getDirectMediaRelaySession = (
    senderId: number,
    peerId: number,
    kind: StreamKind
  ): TDirectMediaRuntimeSession | undefined => {
    if (kind !== StreamKind.SCREEN && kind !== StreamKind.SCREEN_AUDIO) return;
    for (const session of this.directMediaSessions.values()) {
      if (
        session.kind === StreamKind.SCREEN &&
        session.senderId === senderId &&
        session.peerId === peerId
      ) {
        return session;
      }
    }
  };

  public hasReadyDirectMedia = (
    senderId: number,
    peerId: number,
    kind: StreamKind
  ) => {
    const directKind =
      kind === StreamKind.SCREEN_AUDIO ? StreamKind.SCREEN : kind;
    for (const session of this.directMediaSessions.values()) {
      if (
        session.senderId === senderId &&
        session.peerId === peerId &&
        session.kind === directKind &&
        session.phase === 'ready'
      )
        return true;
    }
    return false;
  };

  private activateDirectMediaSession = async (
    session: TDirectMediaRuntimeSession
  ): Promise<void> => {
    if (session.kind !== StreamKind.SCREEN) {
      session.phase = 'ready';
      clearTimeout(session.deadline);
      session.deadline = undefined;
      this.closeDirectMediaRelayConsumers(session);
      return;
    }
    session.phase = 'activating';
    const retained = this.captureDirectMediaRelayConsumers(
      session.senderId,
      session.peerId,
      session.kind
    );
    this.updateDirectMediaRelayConsumers(session, retained);
    const transition = (async () => {
      try {
        for (const entry of retained) {
          if (
            this.directMediaSessions.get(session.id) !== session ||
            session.phase !== 'activating'
          ) {
            return;
          }
          if (!this.hasExactRetainedConsumers(session)) {
            throw new Error('Direct media relay consumer changed');
          }
          await entry.consumer.pause();
          if (
            this.directMediaSessions.get(session.id) !== session ||
            session.phase !== 'activating'
          ) {
            return;
          }
          if (!this.hasExactRetainedConsumers(session)) {
            throw new Error('Direct media relay consumer changed');
          }
        }
        if (
          this.directMediaSessions.get(session.id) !== session ||
          session.phase !== 'activating'
        ) {
          return;
        }
        if (!this.hasExactRetainedConsumers(session)) {
          throw new Error('Direct media relay consumer changed');
        }
        session.phase = 'ready';
        clearTimeout(session.deadline);
        session.deadline = undefined;
      } catch (error) {
        if (
          this.directMediaSessions.get(session.id) === session &&
          session.phase === 'activating'
        ) {
          for (const entry of retained) {
            const key = this.getConsumerKey(session.senderId, entry.kind);
            if (
              this.consumers[session.peerId]?.[key] !== entry.consumer ||
              entry.consumer.closed ||
              !entry.consumer.paused
            ) {
              continue;
            }
            try {
              await entry.consumer.resume();
            } catch {
              this.discardDirectMediaRelayConsumer(
                session,
                entry.kind,
                entry.consumer
              );
              continue;
            }
            if (
              this.directMediaSessions.get(session.id) !== session ||
              session.phase !== 'activating'
            ) {
              return;
            }
            if (
              this.consumers[session.peerId]?.[key] !== entry.consumer ||
              entry.consumer.closed
            ) {
              continue;
            }
          }
          session.phase = 'answered';
        }
        throw error;
      }
    })();
    session.transition = transition;
    try {
      await transition;
    } finally {
      if (session.transition === transition) session.transition = undefined;
    }
  };

  private hasExactRetainedConsumers = (
    session: TDirectMediaRuntimeSession
  ): boolean =>
    session.relayConsumers?.every(
      ({ kind, consumer }) =>
        !consumer.closed &&
        this.consumers[session.peerId]?.[
          this.getConsumerKey(session.senderId, kind)
        ] === consumer
    ) ?? true;

  private canRestoreDirectMediaRelay = (
    session: TDirectMediaRuntimeSession
  ): boolean =>
    !this.destroyed &&
    !!this.getUser(session.senderId) &&
    !!this.getUser(session.peerId) &&
    (session.kind === StreamKind.AUDIO ||
      !this.getUserState(session.peerId).voiceOnlyMode) &&
    !!this.getProducer(session.kind, session.senderId);

  private isTransitioningDirectMediaConsumer = (
    senderId: number,
    peerId: number,
    kind: StreamKind,
    consumer: Consumer<AppData>
  ): boolean => {
    for (const session of this.directMediaSessions.values()) {
      if (
        session.kind !== StreamKind.SCREEN ||
        session.senderId !== senderId ||
        session.peerId !== peerId ||
        (session.phase !== 'activating' && session.phase !== 'retiring')
      ) {
        continue;
      }
      if (
        session.relayConsumers?.some(
          (entry) => entry.kind === kind && entry.consumer === consumer
        )
      ) {
        return true;
      }
    }
    return false;
  };

  private closeDirectMediaRelayConsumers = (
    session: TDirectMediaRuntimeSession
  ) => {
    for (const kind of this.getDirectMediaRelayKinds(session.kind)) {
      const key = this.getConsumerKey(session.senderId, kind);
      this.consumers[session.peerId]?.[key]?.close();
      delete this.consumers[session.peerId]?.[key];
    }
  };

  private clearDirectMediaFailures = (userId: number, kind?: StreamKind) => {
    if (kind === StreamKind.SCREEN_AUDIO) return;
    for (const key of this.directMediaFailedPairs) {
      if (
        kind === undefined
          ? key.startsWith(`${userId}-`) || key.endsWith(`-${userId}`)
          : key.startsWith(`${userId}-${kind}-`)
      )
        this.directMediaFailedPairs.delete(key);
    }
  };

  private endDirectMediaSessionsForProducer = (
    userId: number,
    kind: StreamKind,
    producerId: string
  ) => {
    for (const session of this.directMediaSessions.values()) {
      if (
        session.senderId === userId &&
        session.kind === kind &&
        session.producerId === producerId
      )
        void this.endDirectMediaSession(session, {
          type: 'stop',
          restoreRelay: false
        });
    }
  };

  public getRelayDemand = (userId: number): TRelayDemandEvent[] => {
    const kinds = [
      StreamKind.AUDIO,
      StreamKind.VIDEO,
      StreamKind.SCREEN,
      StreamKind.SCREEN_AUDIO
    ] as const;
    return kinds.map((kind) => ({
      channelId: this.id,
      kind,
      required: Object.entries(this.consumers).some(([peerId, consumers]) => {
        const consumer = consumers[this.getConsumerKey(userId, kind)];
        return (
          !!consumer &&
          !consumer.closed &&
          !consumer.paused &&
          !this.hasReadyDirectMedia(userId, Number(peerId), kind)
        );
      })
    }));
  };

  public publishRelayDemand = (userId: number) => {
    for (const event of this.getRelayDemand(userId))
      pubsub.publishFor([userId], ServerEvents.VOICE_RELAY_DEMAND, event);
  };

  public getScreenViewers = (): TScreenViewersSnapshot => {
    const demos: TScreenViewersSnapshot['demos'] = {};

    for (const [presenterId, producer] of Object.entries(
      this.screenProducers
    )) {
      if (producer.closed) continue;

      const presenterUserId = Number(presenterId);
      const viewerIds = new Set<number>();
      const consumerKey = this.getConsumerKey(
        presenterUserId,
        StreamKind.SCREEN
      );

      for (const [viewerId, consumers] of Object.entries(this.consumers)) {
        const viewerUserId = Number(viewerId);
        const consumer = consumers[consumerKey];

        if (viewerUserId === presenterUserId) continue;
        if (!consumer || consumer.closed) continue;
        if (consumer.producerId !== producer.id) continue;
        if (consumer.paused || consumer.producerPaused) continue;

        viewerIds.add(viewerUserId);
      }

      for (const session of this.directMediaSessions.values()) {
        if (session.kind !== StreamKind.SCREEN) continue;
        if (session.senderId !== presenterUserId) continue;
        if (session.phase !== 'ready') continue;
        if (session.producerId !== producer.id) continue;
        if (!this.getUser(session.peerId)) continue;

        viewerIds.add(session.peerId);
      }

      viewerIds.delete(presenterUserId);

      demos[presenterUserId] = {
        producerId: producer.id,
        viewerIds: [...viewerIds].sort((first, second) => first - second)
      };
    }

    return { channelId: this.id, demos };
  };

  public publishScreenViewers = (): void => {
    pubsub.publish(ServerEvents.VOICE_SCREEN_VIEWERS_CHANGED, {
      channelId: this.id
    });
  };

  public getRouter = (): Router<AppData> => {
    if (!this.router) {
      throw new Error('Router not initialized yet');
    }

    return this.router;
  };

  private createRouter = async () => {
    const router = await mediaSoupWorker.createRouter(defaultRouterOptions);

    this.router = router;
  };

  public createTransport = async (userId: number) => {
    const router = this.getRouter();

    const maxBitrate = config.webRtc.maxBitrate;

    const transport = await router.createWebRtcTransport({
      webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      preferTcp: false,
      initialAvailableOutgoingBitrate: Math.min(10000000, maxBitrate)
    });

    await transport.setMaxIncomingBitrate(maxBitrate);
    await transport.setMaxOutgoingBitrate(maxBitrate);

    const params: TTransportParams = {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      iceServers: getIceServers(userId)
    };

    return { transport, params };
  };

  public createConsumerTransport = async (userId: number) => {
    const member = this.getUser(userId);
    const { transport, params } = await this.createTransport(userId);
    if (!member || this.getUser(userId) !== member || this.destroyed) {
      transport.close();
      throw new Error('Voice membership changed while creating transport');
    }

    this.consumerTransports[userId]?.close();
    this.consumerTransports[userId] = transport;

    transport.observer.on('close', () => {
      if (this.consumerTransports[userId] !== transport) return;

      delete this.consumerTransports[userId];

      if (this.consumers[userId]) {
        Object.values(this.consumers[userId]).forEach((consumer) => {
          consumer.close();
        });

        delete this.consumers[userId];
      }
    });

    transport.on('dtlsstatechange', (state) => {
      if (
        this.consumerTransports[userId] === transport &&
        (state === 'failed' || state === 'closed')
      ) {
        this.removeConsumerTransport(userId);
      }
    });

    return params;
  };

  public removeConsumerTransport = (userId: number) => {
    const transport = this.consumerTransports[userId];

    if (!transport) return;

    transport.close();
  };

  public getConsumerTransport = (userId: number) => {
    return this.consumerTransports[userId];
  };

  public createProducerTransport = async (userId: number) => {
    const member = this.getUser(userId);
    const { params, transport } = await this.createTransport(userId);
    if (!member || this.getUser(userId) !== member || this.destroyed) {
      transport.close();
      throw new Error('Voice membership changed while creating transport');
    }

    this.producerTransports[userId]?.close();
    this.producerTransports[userId] = transport;

    transport.observer.on('close', () => {
      if (this.producerTransports[userId] !== transport) return;

      delete this.producerTransports[userId];

      this.removeProducer(userId, StreamKind.AUDIO);
      this.removeProducer(userId, StreamKind.VIDEO);
      this.removeProducer(userId, StreamKind.SCREEN);
      this.removeProducer(userId, StreamKind.SCREEN_AUDIO);
    });

    transport.on('dtlsstatechange', (state) => {
      if (
        this.producerTransports[userId] === transport &&
        (state === 'failed' || state === 'closed')
      ) {
        this.removeProducerTransport(userId);
      }
    });

    return params;
  };

  public removeProducerTransport = (userId: number) => {
    const transport = this.producerTransports[userId];

    if (!transport) return;

    transport.close();
  };

  public getProducerTransport = (userId: number) => {
    return this.producerTransports[userId];
  };

  public getProducer = (type: StreamKind, id: number) => {
    switch (type) {
      case StreamKind.VIDEO:
        return this.videoProducers[id];
      case StreamKind.AUDIO:
        return this.audioProducers[id];
      case StreamKind.SCREEN:
        return this.screenProducers[id];
      case StreamKind.SCREEN_AUDIO:
        return this.screenAudioProducers[id];
      case StreamKind.EXTERNAL_VIDEO:
        return this.externalStreamsInternal[id]?.producers.videoProducer;
      case StreamKind.EXTERNAL_AUDIO:
        return this.externalStreamsInternal[id]?.producers.audioProducer;
      default:
        return undefined;
    }
  };

  public addProducer = (
    userId: number,
    type: StreamKind,
    producer: Producer,
    qualityLayers?: TStreamQualityLayer[],
    generation?: number
  ) => {
    try {
      this.assertMediaAllowed(userId, type, generation);
    } catch (error) {
      producer.close();
      throw error;
    }
    const validatedQualityLayers = this.validateProducerQualityLayers(
      producer,
      qualityLayers
    );

    this.removeProducer(userId, type);
    this.clearDirectMediaFailures(userId, type);
    for (const session of this.directMediaSessions.values()) {
      if (
        session.senderId === userId &&
        session.kind === type &&
        !session.producerId
      )
        session.producerId = producer.id;
    }

    if (type === StreamKind.VIDEO) {
      this.videoProducers[userId] = producer;
    } else if (type === StreamKind.AUDIO) {
      this.audioProducers[userId] = producer;
    } else if (type === StreamKind.SCREEN) {
      this.screenProducers[userId] = producer;
    } else if (type === StreamKind.SCREEN_AUDIO) {
      this.screenAudioProducers[userId] = producer;
    }

    this.setProducerQualityLayers(userId, type, validatedQualityLayers);

    eventBus.emit('voice:producer_added', {
      channelId: this.id,
      userId,
      kind: type,
      producerId: producer.id
    });

    if (type === StreamKind.SCREEN) {
      this.publishScreenViewers();
    }

    producer.observer.on('close', () => {
      if (this.getProducer(type, userId) !== producer) return;
      eventBus.emit('voice:producer_removed', {
        channelId: this.id,
        userId,
        kind: type,
        producerId: producer.id
      });

      this.endDirectMediaSessionsForProducer(userId, type, producer.id);
      if (type === StreamKind.VIDEO) {
        delete this.videoProducers[userId];
      } else if (type === StreamKind.AUDIO) {
        delete this.audioProducers[userId];
      } else if (type === StreamKind.SCREEN) {
        delete this.screenProducers[userId];
      } else if (type === StreamKind.SCREEN_AUDIO) {
        delete this.screenAudioProducers[userId];
      }

      this.setProducerQualityLayers(userId, type, []);

      if (type === StreamKind.SCREEN) {
        this.publishScreenViewers();
      }
    });
  };

  public removeProducer(userId: number, type: StreamKind) {
    let producer: Producer | undefined;

    switch (type) {
      case StreamKind.VIDEO:
        producer = this.videoProducers[userId];
        break;
      case StreamKind.AUDIO:
        producer = this.audioProducers[userId];
        break;
      case StreamKind.SCREEN:
        producer = this.screenProducers[userId];
        break;
      case StreamKind.SCREEN_AUDIO:
        producer = this.screenAudioProducers[userId];
        break;
      default:
        return;
    }

    if (!producer) return;
    this.endDirectMediaSessionsForProducer(userId, type, producer.id);

    producer.close();

    if (type === StreamKind.VIDEO) {
      delete this.videoProducers[userId];
    } else if (type === StreamKind.AUDIO) {
      delete this.audioProducers[userId];
    } else if (type === StreamKind.SCREEN) {
      delete this.screenProducers[userId];
    } else if (type === StreamKind.SCREEN_AUDIO) {
      delete this.screenAudioProducers[userId];
    }

    this.setProducerQualityLayers(userId, type, []);
  }

  public getProducerQualityLayers = (remoteId: number, kind: StreamKind) => {
    return (
      this.producerQualityLayers[this.getProducerKey(remoteId, kind)] ?? []
    );
  };

  public addConsumer = (
    userId: number,
    remoteId: number,
    kind: StreamKind,
    consumer: Consumer<AppData>,
    generation?: number
  ) => {
    try {
      this.assertMediaAllowed(userId, kind, generation);
      invariant(!this.hasReadyDirectMedia(remoteId, userId, kind), {
        code: 'CONFLICT',
        message: 'This media is already delivered directly'
      });
    } catch (error) {
      consumer.close();
      throw error;
    }
    if (!this.consumers[userId]) {
      this.consumers[userId] = {};
    }

    const streamKey = this.getConsumerKey(remoteId, kind);

    this.consumers[userId][streamKey]?.close();
    this.consumers[userId][streamKey] = consumer;
    const directSession = this.getDirectMediaRelaySession(
      remoteId,
      userId,
      kind
    );
    if (
      directSession &&
      (directSession.phase === 'pending' ||
        directSession.phase === 'offered' ||
        directSession.phase === 'answered')
    ) {
      this.updateDirectMediaRelayConsumers(
        directSession,
        this.captureDirectMediaRelayConsumers(
          remoteId,
          userId,
          directSession.kind
        )
      );
    }

    consumer.observer.on('close', () => {
      if (this.consumers[userId]?.[streamKey] !== consumer) return;
      const transitioning = this.isTransitioningDirectMediaConsumer(
        remoteId,
        userId,
        kind,
        consumer
      );
      delete this.consumers[userId]?.[streamKey];
      if (!transitioning) this.publishRelayDemand(remoteId);
      if (kind === StreamKind.SCREEN && !transitioning) {
        this.publishScreenViewers();
      }
    });
    consumer.observer.on('pause', () => {
      if (
        !this.isTransitioningDirectMediaConsumer(
          remoteId,
          userId,
          kind,
          consumer
        )
      ) {
        this.publishRelayDemand(remoteId);
      }
    });
    consumer.observer.on('resume', () => {
      if (
        !this.isTransitioningDirectMediaConsumer(
          remoteId,
          userId,
          kind,
          consumer
        )
      ) {
        this.publishRelayDemand(remoteId);
      }
    });
    this.publishRelayDemand(remoteId);

    if (kind === StreamKind.SCREEN) {
      this.publishScreenViewers();
    }
  };

  public createExternalStream = (options: {
    title: string;
    key: string;
    pluginId: string;
    avatarUrl?: string;
    bannerUrl?: string;
    producers: {
      audio?: Producer;
      video?: Producer;
    };
    videoLayers?: TStreamQualityLayer[];
  }) => {
    const streamId = this.externalCounter++;

    const { title, key, pluginId, avatarUrl, bannerUrl, producers } = options;

    const validatedVideoLayers = this.validateProducerQualityLayers(
      producers.video,
      options.videoLayers
    );

    this.externalStreamsInternal[streamId] = {
      title,
      key,
      pluginId,
      avatarUrl,
      bannerUrl,
      producers: {
        audioProducer: producers.audio,
        videoProducer: producers.video
      }
    };

    if (producers.audio) {
      this.setupExternalProducerCloseHandler(
        streamId,
        'audio',
        producers.audio
      );
    }

    if (producers.video) {
      this.setProducerQualityLayers(
        streamId,
        StreamKind.EXTERNAL_VIDEO,
        validatedVideoLayers
      );
      this.setupExternalProducerCloseHandler(
        streamId,
        'video',
        producers.video
      );
    }

    this.state.externalStreams[streamId] = {
      title,
      key,
      pluginId,
      avatarUrl,
      bannerUrl,
      tracks: {
        audio: !!producers.audio,
        video: !!producers.video
      }
    };

    return streamId;
  };

  private setupExternalProducerCloseHandler = (
    streamId: number,
    kind: 'audio' | 'video',
    producer: Producer
  ) => {
    producer.observer.on('close', () => {
      const internal = this.externalStreamsInternal[streamId];

      if (!internal) return;

      if (kind === 'audio') {
        delete internal.producers.audioProducer;
      } else {
        delete internal.producers.videoProducer;
        this.setProducerQualityLayers(streamId, StreamKind.EXTERNAL_VIDEO, []);
      }

      const hasProducers =
        internal.producers.audioProducer || internal.producers.videoProducer;

      if (!hasProducers) {
        this.removeExternalStream(streamId);
      } else {
        const existingStream = this.state.externalStreams[streamId];

        if (existingStream) {
          existingStream.tracks = {
            audio: !!internal.producers.audioProducer,
            video: !!internal.producers.videoProducer
          };

          pubsub.publish(ServerEvents.VOICE_UPDATE_EXTERNAL_STREAM, {
            channelId: this.id,
            streamId,
            stream: existingStream
          });
        }
      }
    });
  };

  public removeExternalStream = (streamId: number) => {
    const internal = this.externalStreamsInternal[streamId];

    if (!internal) return;

    if (
      internal.producers.audioProducer &&
      !internal.producers.audioProducer.closed
    ) {
      internal.producers.audioProducer.close();
    }
    if (
      internal.producers.videoProducer &&
      !internal.producers.videoProducer.closed
    ) {
      internal.producers.videoProducer.close();
    }

    this.setProducerQualityLayers(streamId, StreamKind.EXTERNAL_VIDEO, []);

    delete this.externalStreamsInternal[streamId];
    delete this.state.externalStreams[streamId];

    pubsub.publish(ServerEvents.VOICE_REMOVE_EXTERNAL_STREAM, {
      channelId: this.id,
      streamId
    });
  };

  public updateExternalStream = (
    streamId: number,
    options: {
      title?: string;
      avatarUrl?: string;
      bannerUrl?: string;
      producers?: {
        audio?: Producer;
        video?: Producer;
      };
      videoLayers?: TStreamQualityLayer[];
    }
  ) => {
    const internal = this.externalStreamsInternal[streamId];

    if (!internal) return;

    const publicStream = this.state.externalStreams[streamId];

    if (!publicStream) return;

    if (options.title !== undefined) {
      internal.title = options.title;
      publicStream.title = options.title;
    }

    if (options.avatarUrl !== undefined) {
      internal.avatarUrl = options.avatarUrl;
      publicStream.avatarUrl = options.avatarUrl;
    }

    if (options.bannerUrl !== undefined) {
      internal.bannerUrl = options.bannerUrl;
      publicStream.bannerUrl = options.bannerUrl;
    }

    if (options.producers) {
      if (options.producers.audio !== undefined) {
        if (
          internal.producers.audioProducer &&
          !internal.producers.audioProducer.closed
        ) {
          internal.producers.audioProducer.close();
        }

        if (options.producers.audio) {
          internal.producers.audioProducer = options.producers.audio;
          this.setupExternalProducerCloseHandler(
            streamId,
            'audio',
            options.producers.audio
          );

          pubsub.publishForChannel(this.id, ServerEvents.VOICE_NEW_PRODUCER, {
            channelId: this.id,
            remoteId: streamId,
            kind: StreamKind.EXTERNAL_AUDIO
          });
        } else {
          delete internal.producers.audioProducer;
        }
      }

      if (options.producers.video !== undefined) {
        const validatedVideoLayers = this.validateProducerQualityLayers(
          options.producers.video,
          options.videoLayers
        );

        if (
          internal.producers.videoProducer &&
          !internal.producers.videoProducer.closed
        ) {
          internal.producers.videoProducer.close();
        }

        if (options.producers.video) {
          internal.producers.videoProducer = options.producers.video;
          this.setProducerQualityLayers(
            streamId,
            StreamKind.EXTERNAL_VIDEO,
            validatedVideoLayers
          );
          this.setupExternalProducerCloseHandler(
            streamId,
            'video',
            options.producers.video
          );

          pubsub.publishForChannel(this.id, ServerEvents.VOICE_NEW_PRODUCER, {
            channelId: this.id,
            remoteId: streamId,
            kind: StreamKind.EXTERNAL_VIDEO
          });
        } else {
          delete internal.producers.videoProducer;
          this.setProducerQualityLayers(
            streamId,
            StreamKind.EXTERNAL_VIDEO,
            []
          );
        }
      }

      publicStream.tracks = {
        audio: !!internal.producers.audioProducer,
        video: !!internal.producers.videoProducer
      };
    }

    if (options.videoLayers !== undefined && !options.producers?.video) {
      const validatedVideoLayers = this.validateProducerQualityLayers(
        internal.producers.videoProducer,
        options.videoLayers
      );

      this.setProducerQualityLayers(
        streamId,
        StreamKind.EXTERNAL_VIDEO,
        validatedVideoLayers
      );
    }

    pubsub.publish(ServerEvents.VOICE_UPDATE_EXTERNAL_STREAM, {
      channelId: this.id,
      streamId,
      stream: publicStream
    });
  };

  public getExternalStreamProducer = (
    streamId: number,
    kind: 'audio' | 'video'
  ): Producer | undefined => {
    const internal = this.externalStreamsInternal[streamId];
    if (!internal) return undefined;

    return kind === 'audio'
      ? internal.producers.audioProducer
      : internal.producers.videoProducer;
  };

  public listProducers = (): TVoiceProducerInfo[] => {
    const maps = [
      [StreamKind.AUDIO, this.audioProducers],
      [StreamKind.VIDEO, this.videoProducers],
      [StreamKind.SCREEN, this.screenProducers],
      [StreamKind.SCREEN_AUDIO, this.screenAudioProducers]
    ] as const;

    return maps.flatMap(([kind, producers]) =>
      Object.entries(producers).map(([userId, producer]) => ({
        userId: +userId,
        kind,
        producerId: producer.id,
        paused: producer.paused
      }))
    );
  };

  public getRemoteIds = (userId: number): TRemoteProducerIds => {
    const producerIds = (producers: TProducerMap, kind: StreamKind) =>
      Object.keys(producers)
        .map(Number)
        .filter(
          (id) => id !== userId && !this.hasReadyDirectMedia(id, userId, kind)
        );
    return {
      remoteVideoIds: producerIds(this.videoProducers, StreamKind.VIDEO),
      remoteAudioIds: producerIds(this.audioProducers, StreamKind.AUDIO),
      remoteScreenIds: producerIds(this.screenProducers, StreamKind.SCREEN),
      remoteScreenAudioIds: producerIds(
        this.screenAudioProducers,
        StreamKind.SCREEN_AUDIO
      ),
      remoteExternalStreamIds: Object.keys(this.externalStreamsInternal).map(
        (id) => +id
      )
    };
  };

  public getExternalStreamTracks = (
    streamId: number
  ): { audio: boolean; video: boolean } => {
    const internal = this.externalStreamsInternal[streamId];
    if (!internal) return { audio: false, video: false };

    return {
      audio: !!internal.producers.audioProducer,
      video: !!internal.producers.videoProducer
    };
  };

  public static getListenInfo = () => {
    return {
      ip: webRtcServerListenInfo.ip,
      announcedAddress: webRtcServerListenInfo.announcedAddress
    };
  };
}

export { EXTERNAL_STREAM_ID_BASE, VoiceRuntime, type TVoiceConnection };
