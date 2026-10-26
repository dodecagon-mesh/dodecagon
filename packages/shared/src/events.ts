import type { TPluginCapabilityAccessRule } from './plugins/capabilities';
import type { TCommandsMapByPlugin } from './plugins/commands';
import type { TLogEntry, TPluginMetadata } from './plugins/manifest';
import type { TPluginPushEvent } from './plugins/primitives';
import type {
  TCategory,
  TChannel,
  TJoinedEmoji,
  TJoinedMessage,
  TJoinedPublicUser,
  TJoinedRole
} from './tables';
import type {
  StreamKind,
  TChannelUserPermissionsMap,
  TPublicServerSettings
} from './types';
import type {
  TDirectMediaEvent,
  TExternalStream,
  TRelayDemandEvent,
  TVoiceUserState
} from './voice';

export enum ServerEvents {
  NEW_MESSAGE = 'newMessage',
  MESSAGE_UPDATE = 'messageUpdate',
  MESSAGE_DELETE = 'messageDelete',
  MESSAGE_TYPING = 'messageTyping',
  THREAD_REPLY_COUNT_UPDATE = 'threadReplyCountUpdate',

  USER_JOIN = 'userJoin',
  USER_LEAVE = 'userLeave',

  CHANNEL_CREATE = 'channelCreate',
  CHANNEL_UPDATE = 'channelUpdate',
  CHANNEL_DELETE = 'channelDelete',
  CHANNEL_PERMISSIONS_UPDATE = 'channelPermissionsUpdate',
  CHANNEL_READ_STATES_UPDATE = 'channelReadStatesUpdate',
  CHANNEL_READ_STATES_DELTA = 'channelReadStatesDelta',

  USER_JOIN_VOICE = 'userJoinVoice',
  USER_LEAVE_VOICE = 'userLeaveVoice',
  USER_VOICE_STATE_UPDATE = 'userVoiceStateUpdate',
  USER_VOICE_MOVED = 'userVoiceMoved',
  USER_VOICE_REACTION = 'userVoiceReaction',

  VOICE_ADD_EXTERNAL_STREAM = 'voiceAddExternalStream',
  VOICE_UPDATE_EXTERNAL_STREAM = 'voiceUpdateExternalStream',
  VOICE_REMOVE_EXTERNAL_STREAM = 'voiceRemoveExternalStream',
  VOICE_NEW_PRODUCER = 'voiceNewProducer',
  VOICE_PRODUCER_CLOSED = 'voiceProducerClosed',
  VOICE_SCREEN_CONSUMER_STARTED = 'voiceScreenConsumerStarted',
  VOICE_SCREEN_VIEWERS_CHANGED = 'voiceScreenViewersChanged',
  VOICE_RELAY_DEMAND = 'voiceRelayDemand',
  DIRECT_MEDIA_SIGNAL = 'directScreenSignal',

  EMOJI_CREATE = 'emojiCreate',
  EMOJI_UPDATE = 'emojiUpdate',
  EMOJI_DELETE = 'emojiDelete',

  ROLE_CREATE = 'roleCreate',
  ROLE_UPDATE = 'roleUpdate',
  ROLE_DELETE = 'roleDelete',

  USER_CREATE = 'userCreate',
  USER_UPDATE = 'userUpdate',
  USER_DELETE = 'userDelete',

  SERVER_SETTINGS_UPDATE = 'serverSettingsUpdate',
  SERVER_UPDATE_STATE = 'serverUpdateState',

  PLUGIN_LOG = 'pluginLog',
  PLUGIN_COMMANDS_CHANGE = 'pluginCommandsChange',
  PLUGIN_COMPONENTS_CHANGE = 'pluginComponentsChange',
  PLUGIN_CAPABILITY_ACCESS_CHANGE = 'pluginCapabilityAccessChange',
  PLUGIN_METADATA_CHANGE = 'pluginMetadataChange',
  PLUGIN_PUSH = 'pluginPush',

  CATEGORY_CREATE = 'categoryCreate',
  CATEGORY_UPDATE = 'categoryUpdate',
  CATEGORY_DELETE = 'categoryDelete',

  DM_CONVERSATION_OPEN = 'dmConversationOpen'
}

/** Null is idle; failed is terminal until another attempt. No private error details. */
export type TServerUpdateState = {
  phase: 'checking' | 'downloading' | 'installing' | 'restarting' | 'failed';
  targetVersion?: string;
} | null;

export type TNewMessage = {
  content: string;
  channelId: number;
};

/**
 * The payload every server event carries over the realtime channel. This is the
 * only place a server event's payload type is declared; the pubsub wrapper and
 * the plugin event bus both read it from here.
 */
export type TServerEventPayloads = {
  [ServerEvents.NEW_MESSAGE]: TJoinedMessage;
  [ServerEvents.MESSAGE_UPDATE]: TJoinedMessage;
  [ServerEvents.MESSAGE_DELETE]: {
    messageId: number;
    channelId: number;
  };
  [ServerEvents.MESSAGE_TYPING]: {
    channelId: number;
    userId: number;
    parentMessageId?: number;
  };
  [ServerEvents.THREAD_REPLY_COUNT_UPDATE]: {
    messageId: number;
    channelId: number;
    replyCount: number;
  };

  [ServerEvents.USER_JOIN]: TJoinedPublicUser;
  [ServerEvents.USER_LEAVE]: number;
  [ServerEvents.USER_CREATE]: TJoinedPublicUser;
  [ServerEvents.USER_UPDATE]: TJoinedPublicUser;
  [ServerEvents.USER_DELETE]: {
    isWipe: boolean;
    userId: number;
    deletedUserId: number; // the special Deleted User placeholder
  };

  [ServerEvents.CHANNEL_CREATE]: TChannel;
  [ServerEvents.CHANNEL_UPDATE]: TChannel;
  [ServerEvents.CHANNEL_DELETE]: number;
  [ServerEvents.CHANNEL_PERMISSIONS_UPDATE]: TChannelUserPermissionsMap;
  [ServerEvents.CHANNEL_READ_STATES_UPDATE]: {
    channelId: number;
    count: number;
  };
  [ServerEvents.CHANNEL_READ_STATES_DELTA]: {
    channelId: number;
    delta: number;
  };

  [ServerEvents.USER_JOIN_VOICE]: {
    channelId: number;
    userId: number;
    state: TVoiceUserState;
    sessionId: string;
  };
  [ServerEvents.USER_LEAVE_VOICE]: {
    channelId: number;
    userId: number;
    sessionId: string;
  };
  [ServerEvents.USER_VOICE_STATE_UPDATE]: {
    channelId: number;
    userId: number;
    state: TVoiceUserState;
  };
  [ServerEvents.USER_VOICE_MOVED]: {
    channelId: number;
    fromChannelId: number;
  };
  [ServerEvents.USER_VOICE_REACTION]: {
    channelId: number;
    userId: number;
    emoji: string;
  };
  [ServerEvents.DIRECT_MEDIA_SIGNAL]: TDirectMediaEvent;
  [ServerEvents.VOICE_RELAY_DEMAND]: TRelayDemandEvent;
  [ServerEvents.VOICE_NEW_PRODUCER]: {
    channelId: number;
    remoteId: number;
    kind: StreamKind;
    replaceConsumerId?: string;
  };
  [ServerEvents.VOICE_ADD_EXTERNAL_STREAM]: {
    channelId: number;
    streamId: number;
    stream: TExternalStream;
  };
  [ServerEvents.VOICE_UPDATE_EXTERNAL_STREAM]: {
    channelId: number;
    streamId: number;
    stream: TExternalStream;
  };
  [ServerEvents.VOICE_REMOVE_EXTERNAL_STREAM]: {
    channelId: number;
    streamId: number;
  };
  [ServerEvents.VOICE_PRODUCER_CLOSED]: {
    channelId: number;
    remoteId: number;
    kind: StreamKind;
    producerId: string;
  };
  [ServerEvents.VOICE_SCREEN_CONSUMER_STARTED]: {
    channelId: number;
    producerId: string;
    peerId: number;
  };
  [ServerEvents.VOICE_SCREEN_VIEWERS_CHANGED]: {
    channelId: number;
  };

  [ServerEvents.PLUGIN_LOG]: TLogEntry;
  [ServerEvents.PLUGIN_COMMANDS_CHANGE]: TCommandsMapByPlugin;
  [ServerEvents.PLUGIN_COMPONENTS_CHANGE]: string[]; // plugin ids with components enabled
  [ServerEvents.PLUGIN_CAPABILITY_ACCESS_CHANGE]: TPluginCapabilityAccessRule[];
  [ServerEvents.PLUGIN_PUSH]: TPluginPushEvent;
  [ServerEvents.PLUGIN_METADATA_CHANGE]: TPluginMetadata[];

  [ServerEvents.EMOJI_CREATE]: TJoinedEmoji;
  [ServerEvents.EMOJI_UPDATE]: TJoinedEmoji;
  [ServerEvents.EMOJI_DELETE]: number;

  [ServerEvents.ROLE_CREATE]: TJoinedRole;
  [ServerEvents.ROLE_UPDATE]: TJoinedRole;
  [ServerEvents.ROLE_DELETE]: number;

  [ServerEvents.SERVER_SETTINGS_UPDATE]: TPublicServerSettings;
  [ServerEvents.SERVER_UPDATE_STATE]: TServerUpdateState;

  [ServerEvents.CATEGORY_CREATE]: TCategory;
  [ServerEvents.CATEGORY_UPDATE]: TCategory;
  [ServerEvents.CATEGORY_DELETE]: number;

  [ServerEvents.DM_CONVERSATION_OPEN]: { channelId: number };
};
