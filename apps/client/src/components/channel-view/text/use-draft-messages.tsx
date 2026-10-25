import { serverIdSelector } from '@/features/server/selectors';
import { ownUserIdSelector } from '@/features/server/users/selectors';
import { store } from '@/features/store';
import {
  getLocalStorageItemAsJSON,
  LocalStorageKey,
  setLocalStorageItemAsJSON
} from '@/helpers/storage';
import { isEmptyMessage } from '@dodecagon/shared';

let drafts: Record<string, string> | undefined;
const pendingChanges = new Map<string, string | undefined>();
let timer: ReturnType<typeof setTimeout> | undefined;

const readStoredDrafts = (): Record<string, string> => {
  const stored = getLocalStorageItemAsJSON<Record<string, unknown>>(
    LocalStorageKey.DRAFT_MESSAGES
  );
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
};

const applyPendingChanges = (target: Record<string, string>) => {
  for (const [key, value] of pendingChanges) {
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
};

const getDraftMessage = (draftKey: string): string => {
  drafts ??= readStoredDrafts();
  return drafts[draftKey] ?? '';
};

const flushDraftMessages = () => {
  clearTimeout(timer);
  timer = undefined;
  if (!pendingChanges.size) return;
  const merged = readStoredDrafts();
  applyPendingChanges(merged);
  setLocalStorageItemAsJSON(LocalStorageKey.DRAFT_MESSAGES, merged);
  drafts = merged;
  pendingChanges.clear();
};

const setDraftMessage = (draftKey: string, message: string) => {
  if (getDraftMessage(draftKey) === message) return;
  if (isEmptyMessage(message)) {
    delete drafts![draftKey];
    pendingChanges.set(draftKey, undefined);
  } else {
    drafts![draftKey] = message;
    pendingChanges.set(draftKey, message);
  }
  clearTimeout(timer);
  timer = setTimeout(flushDraftMessages, 300);
};

const getChannelDraftKey = (
  channelId: number,
  parentMessageId?: number
): string => {
  const state = store.getState();
  const serverId = serverIdSelector(state);
  const userId = ownUserIdSelector(state);
  return JSON.stringify([serverId, userId, channelId, parentMessageId ?? null]);
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDraftMessages);
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== LocalStorageKey.DRAFT_MESSAGES)
      return;
    const merged = readStoredDrafts();
    applyPendingChanges(merged);
    drafts = merged;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDraftMessages();
  });
}

export {
  flushDraftMessages,
  getChannelDraftKey,
  getDraftMessage,
  setDraftMessage
};
