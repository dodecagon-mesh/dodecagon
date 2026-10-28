export enum LocalStorageKey {
  IDENTITY = 'dodecagon-identity',
  VITE_UI_THEME = 'vite-ui-theme',
  DEVICES_SETTINGS = 'dodecagon-devices-settings',
  RIGHT_SIDEBAR_STATE = 'dodecagon-right-sidebar-state',
  VOICE_CHAT_SIDEBAR_STATE = 'dodecagon-voice-chat-sidebar-state',
  VOICE_CHAT_SIDEBAR_CHANNEL_ID = 'dodecagon-voice-chat-sidebar-channel-id',
  VOICE_CHAT_SIDEBAR_WIDTH = 'dodecagon-voice-chat-sidebar-width',
  VOICE_CHAT_SHOW_USER_BANNERS = 'dodecagon-voice-chat-show-user-banners',
  VOLUME_SETTINGS = 'dodecagon-volume-settings',
  STREAM_QUALITY_SETTINGS = 'dodecagon-stream-quality-settings',
  RECENT_EMOJIS = 'dodecagon-recent-emojis',
  DEBUG = 'dodecagon-debug',
  DRAFT_MESSAGES = 'dodecagon-draft-messages',
  HIDE_NON_VIDEO_PARTICIPANTS = 'dodecagon-hide-non-video-participants',
  THREAD_SIDEBAR_WIDTH = 'dodecagon-thread-sidebar-width',
  LEFT_SIDEBAR_WIDTH = 'dodecagon-left-sidebar-width',
  RIGHT_SIDEBAR_WIDTH = 'dodecagon-right-sidebar-width',
  CATEGORIES_EXPANDED = 'dodecagon-categories-expanded',
  AUTO_LOGIN = 'dodecagon-auto-login',
  AUTO_LOGIN_TOKEN = 'dodecagon-auto-login-token',
  LAST_SELECTED_CHANNEL = 'dodecagon-last-selected-channel',
  AUTO_JOIN_LAST_CHANNEL = 'dodecagon-auto-join-last-channel',
  BROWSER_NOTIFICATIONS = 'dodecagon-browser-notifications',
  BROWSER_NOTIFICATIONS_FOR_MENTIONS = 'dodecagon-browser-notifications-for-mentions',
  BROWSER_NOTIFICATIONS_FOR_DMS = 'dodecagon-browser-notifications-for-dms',

  BROWSER_NOTIFICATIONS_FOR_REPLIES = 'dodecagon-browser-notifications-for-replies',
  LANGUAGE = 'dodecagon-language',
  PLUGIN_SLOT_DEBUG = 'dodecagon-plugin-slot-debug',
  SHORTCUT_OVERRIDES = 'dodecagon-shortcut-overrides',
  HIDE_OWN_SCREEN_SHARE = 'dodecagon-hide-own-screen-share',
  HIDDEN_REMOTE_WEBCAMS = 'dodecagon-hidden-remote-webcams',
  NOTIFICATION_SOUNDS = 'dodecagon-notification-sounds',
  MESSAGE_SENT_SOUND = 'dodecagon-message-sent-sound',
  JOIN_LEAVE_SOUNDS = 'dodecagon-join-leave-sounds',
  MUTE_DEAFEN_SOUNDS = 'dodecagon-mute-deafen-sounds',
  MUTED_CHANNEL_IDS = 'dodecagon-muted-channel-ids',
  // survives the browser and the tab, so a reload loop cannot outlive the storage it needs
  CLIENT_RELOAD = 'dodecagon-client-reload'
}

export enum SessionStorageKey {
  TOKEN = 'dodecagon-token',
  CLIENT_RELOAD = 'dodecagon-client-reload',
  OIDC_NO_AUTO_REDIRECT = 'dodecagon-oidc-no-auto-redirect'
}

// the keys carried the old brand until the rename, so the values an existing
// install already saved have to move over once instead of being dropped
const LEGACY_KEY_PREFIX = 'sharkord-';
const CURRENT_KEY_PREFIX = 'dodecagon-';

const legacyKeyFor = (key: string): string | null => {
  if (!key.startsWith(CURRENT_KEY_PREFIX)) return null;

  return `${LEGACY_KEY_PREFIX}${key.slice(CURRENT_KEY_PREFIX.length)}`;
};

// librewolf and firefox private mode throw SecurityError when privacy hardening
// blocks storage access, so every read/write has to survive the storage being gone
const readItem = (kind: 'local' | 'session', key: string): string | null => {
  try {
    const storage = kind === 'local' ? localStorage : sessionStorage;

    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeItem = (kind: 'local' | 'session', key: string, value: string) => {
  try {
    const storage = kind === 'local' ? localStorage : sessionStorage;

    storage.setItem(key, value);
  } catch {
    // storage is unavailable, the value just does not persist
  }
};

const deleteItem = (kind: 'local' | 'session', key: string) => {
  try {
    const storage = kind === 'local' ? localStorage : sessionStorage;

    storage.removeItem(key);
  } catch {
    // storage is unavailable, nothing to remove
  }
};

const getLocalStorageItem = (key: LocalStorageKey): string | null => {
  return readItem('local', key);
};

const getLocalStorageItemBool = (
  key: LocalStorageKey,
  defaultValue: boolean = false
): boolean => {
  const item = readItem('local', key);

  if (item === null) {
    return defaultValue ?? false;
  }

  return item === 'true';
};

const setLocalStorageItemBool = (
  key: LocalStorageKey,
  value: boolean
): void => {
  writeItem('local', key, value.toString());
};

const getLocalStorageItemAsNumber = (
  key: LocalStorageKey,
  defaultValue?: number
): number | undefined => {
  const item = readItem('local', key);

  if (item === null) {
    return defaultValue;
  }

  const parsed = parseInt(item, 10);

  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const getLocalStorageItemAsJSON = <T>(
  key: LocalStorageKey,
  defaultValue: T | undefined = undefined
): T | undefined => {
  const item = readItem('local', key);

  if (item) {
    try {
      return JSON.parse(item) as T;
    } catch {
      return defaultValue;
    }
  }

  return defaultValue;
};

const setLocalStorageItemAsJSON = <T>(key: LocalStorageKey, value: T): void => {
  writeItem('local', key, JSON.stringify(value));
};

const setLocalStorageItem = (key: LocalStorageKey, value: string): void => {
  writeItem('local', key, value);
};

const removeLocalStorageItem = (key: LocalStorageKey): void => {
  deleteItem('local', key);
};

const getSessionStorageItem = (key: SessionStorageKey): string | null => {
  return readItem('session', key);
};

const setSessionStorageItem = (key: SessionStorageKey, value: string): void => {
  writeItem('session', key, value);
};

const removeSessionStorageItem = (key: SessionStorageKey): void => {
  deleteItem('session', key);
};

const migrateStorageKeys = (
  kind: 'local' | 'session',
  keys: (LocalStorageKey | SessionStorageKey)[]
): void => {
  for (const key of keys) {
    const legacyKey = legacyKeyFor(key);

    if (!legacyKey) continue;

    const legacyValue = readItem(kind, legacyKey);

    if (legacyValue === null) continue;

    if (readItem(kind, key) === null) writeItem(kind, key, legacyValue);

    deleteItem(kind, legacyKey);
  }
};

/**
 * Moves the values saved under the old brand's keys to the current ones and
 * drops the old keys. Runs once per install, the values themselves are kept.
 */
const migrateLegacyStorageKeys = (): void => {
  migrateStorageKeys('local', Object.values(LocalStorageKey));
  migrateStorageKeys('session', Object.values(SessionStorageKey));
};

export {
  getLocalStorageItem,
  getLocalStorageItemAsJSON,
  getLocalStorageItemAsNumber,
  getLocalStorageItemBool,
  getSessionStorageItem,
  migrateLegacyStorageKeys,
  removeLocalStorageItem,
  removeSessionStorageItem,
  setLocalStorageItem,
  setLocalStorageItemAsJSON,
  setLocalStorageItemBool,
  setSessionStorageItem
};
