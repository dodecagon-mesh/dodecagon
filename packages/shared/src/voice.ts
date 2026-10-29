import type { IceCandidate, IceParameters } from 'mediasoup/types';
import { StreamKind, type TExternalStreamTracks } from './types';

export type { ConsumerType } from 'mediasoup/types';

export type TVoiceUserState = {
  micMuted: boolean;
  soundMuted: boolean;
  webcamEnabled: boolean;
  sharingScreen: boolean;
  voiceOnlyMode?: boolean;
  directMediaEnabled?: boolean;
};

export type TVoiceUser = {
  userId: number;
  state: TVoiceUserState;
};

export type TExternalStream = {
  title: string;
  key: string;
  pluginId: string;
  avatarUrl?: string;
  bannerUrl?: string;
  tracks: TExternalStreamTracks;
};

export type TChannelState = {
  users: TVoiceUser[];
  externalStreams: { [streamId: number]: TExternalStream };
};

export type TIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type TTransportParams = {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: any;
  iceServers?: TIceServer[];
};

export type TVoiceMap = {
  [channelId: number]: {
    users: {
      [userId: number]: TVoiceUserState;
    };
  };
};

export type TExternalStreamsMap = {
  [channelId: number]: {
    [streamId: number]: TExternalStream;
  };
};

export type TVoiceProducerInfo = {
  userId: number;
  kind: StreamKind;
  producerId: string;
  paused: boolean;
};

// the client waits longer than the server so a server fallback always wins the race.
// negotiation covers offer/answer and the native announce; connection starts at the
// answer, once both peers can actually begin the DHT handshake and ICE.
export const DIRECT_MEDIA_CONNECT_TIMEOUT_MS = 15000;
export const DIRECT_MEDIA_AUDIO_CONNECT_TIMEOUT_MS = 15000;
export const DIRECT_MEDIA_NEGOTIATION_TIMEOUT_MS = 25000;
export const DIRECT_MEDIA_SERVER_CONNECT_TIMEOUT_MS = 12000;
export const DIRECT_MEDIA_SERVER_AUDIO_CONNECT_TIMEOUT_MS = 12000;
export const DIRECT_MEDIA_SERVER_NEGOTIATION_TIMEOUT_MS = 20000;
export const DIRECT_MEDIA_SDP_MAX_LENGTH = 65536;

export const DIRECT_MEDIA_KINDS = [
  StreamKind.AUDIO,
  StreamKind.VIDEO,
  StreamKind.SCREEN
] as const;
export type TDirectMediaKind = (typeof DIRECT_MEDIA_KINDS)[number];

export type TDirectMediaSignal =
  | { type: 'offer'; sdp: string; publicKey: string }
  | { type: 'answer'; sdp: string; publicKey: string }
  | { type: 'ready' }
  | { type: 'fallback'; reason?: 'unwatch' }
  | { type: 'stop' };

export type TDirectMediaSession = {
  kind: TDirectMediaKind;
  sessionId: string;
  peerId: number;
  transport: 'holepunch';
};

export type TDirectMediaEvent = {
  kind: TDirectMediaKind;
  relayAllowed: boolean;
  sessionId: string;
  channelId: number;
  senderId: number;
  fromUserId: number;
  transport: 'holepunch';
  signal: TDirectMediaSignal;
};

export type TRelayDemandEvent = {
  channelId: number;
  kind:
    | StreamKind.AUDIO
    | StreamKind.VIDEO
    | StreamKind.SCREEN
    | StreamKind.SCREEN_AUDIO;
  required: boolean;
};

export type TScreenViewerDemo = {
  producerId: string;
  viewerIds: number[];
};

export type TScreenViewersSnapshot = {
  channelId: number;
  demos: {
    [presenterId: number]: TScreenViewerDemo;
  };
};
