import {
  getLocalStorageItem,
  getLocalStorageItemBool,
  getSessionStorageItem,
  LocalStorageKey,
  SessionStorageKey
} from '@/helpers/storage';

/**
 * Whether the browser of this tab holds a session the app resumes on its own.
 */
export const hasStoredSession = (): boolean =>
  !!getSessionStorageItem(SessionStorageKey.TOKEN) ||
  (getLocalStorageItemBool(LocalStorageKey.AUTO_LOGIN) &&
    !!getLocalStorageItem(LocalStorageKey.AUTO_LOGIN_TOKEN));
