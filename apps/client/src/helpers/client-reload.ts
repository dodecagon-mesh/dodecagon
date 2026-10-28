import {
  getLocalStorageItem,
  getSessionStorageItem,
  LocalStorageKey,
  SessionStorageKey,
  setLocalStorageItem,
  setSessionStorageItem
} from '@/helpers/storage';

// A server publishes a new client in place, and the document a browser already runs keeps
// asking for the bundle it was built with. One reload picks the new build up. The reload is
// only useful while it converges: a document that cannot reach the version it compares
// against reloads forever, and every reload spends a handshake and a join, so the server
// answers the repetition with a rate limit instead of the app.
const RELOAD_WINDOW_MS = 60_000;

type TReloadRecord = {
  version: string;
  at: number;
};

const parseRecord = (raw: string | null): TReloadRecord | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TReloadRecord>;

    return typeof parsed.version === 'string' && typeof parsed.at === 'number'
      ? { version: parsed.version, at: parsed.at }
      : null;
  } catch {
    return null;
  }
};

// storage of the browser can be unavailable, and the tab storage is not carried across a
// restart, so the newest record of either place is the one that counts
const readRecord = (): TReloadRecord | null => {
  const stored = [
    parseRecord(getLocalStorageItem(LocalStorageKey.CLIENT_RELOAD)),
    parseRecord(getSessionStorageItem(SessionStorageKey.CLIENT_RELOAD))
  ].filter((record): record is TReloadRecord => record !== null);

  if (stored.length === 0) return null;

  return stored.reduce((newest, record) =>
    record.at > newest.at ? record : newest
  );
};

/**
 * Reloads the document for a client the server publishes, at most once per version and
 * once a minute. Returns whether this call reloaded the document.
 */
export const reloadForServerVersion = (serverVersion: string): boolean => {
  const record = readRecord();

  if (record) {
    if (record.version === serverVersion) return false;
    if (Date.now() - record.at < RELOAD_WINDOW_MS) return false;
  }

  const next: TReloadRecord = { version: serverVersion, at: Date.now() };
  const serialized = JSON.stringify(next);

  setLocalStorageItem(LocalStorageKey.CLIENT_RELOAD, serialized);
  setSessionStorageItem(SessionStorageKey.CLIENT_RELOAD, serialized);
  window.location.reload();

  return true;
};
