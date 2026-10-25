import { setStoreState, store } from '@/features/store';
import { LocalStorageKey } from '@/helpers/storage';
import { expect, test } from 'bun:test';
import {
  flushDraftMessages,
  getChannelDraftKey,
  getDraftMessage,
  setDraftMessage
} from '../use-draft-messages';

test('draft typing stays in memory until flush and scopes server, user, channel and thread', () => {
  const previousStorage = globalThis.localStorage;
  const previousState = store.getState();
  let reads = 0;
  let writes = 0;
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => {
        reads++;
        return saved.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        writes++;
        saved.set(key, value);
      }
    }
  });
  try {
    setStoreState({
      server: { ...previousState.server, serverId: 'server-one', ownUserId: 1 }
    });
    const channel = getChannelDraftKey(1);
    const thread = getChannelDraftKey(1, 9);
    expect(channel).not.toBe(thread);
    expect(getDraftMessage(channel)).toBe('');
    const initialReads = reads;
    for (const value of ['h', 'he', 'hel', 'hello'])
      setDraftMessage(channel, value);
    expect(reads).toBe(initialReads);
    expect(writes).toBe(0);
    expect(getDraftMessage(channel)).toBe('hello');
    setDraftMessage(thread, 'thread draft');
    flushDraftMessages();
    expect(writes).toBe(1);
    expect(JSON.parse(saved.get(LocalStorageKey.DRAFT_MESSAGES)!)[thread]).toBe(
      'thread draft'
    );
    setStoreState({
      server: { ...previousState.server, serverId: 'server-two', ownUserId: 1 }
    });
    expect(getDraftMessage(getChannelDraftKey(1))).toBe('');
    setStoreState({
      server: { ...previousState.server, serverId: 'server-one', ownUserId: 2 }
    });
    expect(getDraftMessage(getChannelDraftKey(1))).toBe('');
    setDraftMessage(channel, '');
    flushDraftMessages();
    expect(
      JSON.parse(saved.get(LocalStorageKey.DRAFT_MESSAGES)!)[channel]
    ).toBeUndefined();
    expect(getDraftMessage(thread)).toBe('thread draft');
  } finally {
    flushDraftMessages();
    setStoreState(previousState);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage
    });
  }
});
