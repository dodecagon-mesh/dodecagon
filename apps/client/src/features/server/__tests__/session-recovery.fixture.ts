import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

// Keep application state, credential storage, join and reconnect orchestration real;
// only the RPC transport, plugin loading and unrelated event domains are substituted.
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  };
};
const local = storage();
const session = storage();
let reloads = 0;
Object.assign(globalThis, {
  localStorage: local,
  sessionStorage: session,
  VITE_APP_VERSION: '0.0.65',
  window: {
    location: {
      protocol: 'https:',
      host: 'example.test',
      reload: () => {
        reloads++;
      }
    },
    addEventListener: () => undefined
  }
});
class RPCError extends Error {
  constructor(public data?: { code: string }) {
    super(data?.code ?? 'Network unavailable');
  }
}
let online = true;
let rateLimited = false;
let authError: string | undefined;
let joinBarrier: Promise<void> | undefined;
let onJoin: (() => void) | undefined;
let passwordRequired = false;
let servedVersion = '0.0.65';
let lastToken = '';
let joinedVoiceSessionId = '';
let wsOptions: {
  onClose: (event: { code: number; reason: string; wasClean: boolean }) => void;
  connectionParams: () => Promise<{ token: string }>;
};
const joined = () => ({
  serverId: 'test',
  categories: [],
  channels: [],
  users: [],
  ownUserId: 7,
  ownUserPasswordSet: true,
  roles: [],
  emojis: [],
  publicSettings: undefined,
  voiceMap: {},
  externalStreamsMap: {},
  channelPermissions: {},
  readStates: {},
  pluginsMetadata: [],
  commands: {},
  pluginCapabilityAccess: [],
  pluginIdsWithComponents: [],
  showWelcomeDialog: false,
  serverVersion: servedVersion
});
mock.module('@trpc/client', () => ({
  TRPCClientError: RPCError,
  createWSClient: (options: typeof wsOptions) => {
    wsOptions = options;
    return { close: () => undefined };
  },
  wsLink: () => ({}),
  createTRPCProxyClient: () => ({
    others: {
      handshake: {
        query: async () => {
          if (rateLimited) throw new RPCError({ code: 'TOO_MANY_REQUESTS' });
          if (!online) throw new RPCError();
          lastToken = (await wsOptions.connectionParams()).token;
          return { hasPassword: passwordRequired, handshakeHash: 'handshake' };
        }
      },
      joinServer: {
        query: async () => {
          if (rateLimited) throw new RPCError({ code: 'TOO_MANY_REQUESTS' });
          if (!online) throw new RPCError();
          onJoin?.();
          if (joinBarrier) await joinBarrier;
          if (authError) throw new RPCError({ code: authError });
          return joined();
        }
      }
    },
    voice: {
      join: {
        mutate: async ({ sessionId }: { sessionId: string }) => {
          joinedVoiceSessionId = sessionId;
          await joinBarrier;
          return { routerRtpCapabilities: { codecs: [] }, sessionId };
        }
      },
      leave: { mutate: async () => undefined }
    }
  })
}));
mock.module('@/helpers/browser-logger', () => ({
  logDebug: () => undefined,
  logVoice: () => undefined,
  logVoiceError: () => undefined
}));
mock.module('@/helpers/sounds', () => ({ playSound: () => undefined }));
mock.module('@/helpers/voice-debug', () => ({
  pushVoiceDebugEvent: () => undefined
}));
mock.module('@/i18n', () => ({
  i18n: { resolvedLanguage: 'en', t: (key: string) => key }
}));
mock.module('../plugins/actions', () => ({
  processPluginComponents: async () => ({}),
  setPluginCapabilityAccess: () => undefined,
  setPluginCommands: () => undefined,
  setPluginComponents: () => undefined
}));
mock.module('../subscriptions', () => ({
  initSubscriptions: () => () => undefined
}));
// Loading after mock registration intentionally exercises the application's
// module initialization boundary; static imports would run before the doubles.
const { store } = await import('../../store');
const { serverInitialState } = await import('../slice');
const {
  connect,
  reconnectToServer,
  cancelReconnect,
  disconnectFromServer,
  resumeSession,
  setServerUpdateState
} = await import('../actions');
const { cleanup } = await import('@/lib/trpc');
const { LocalStorageKey: L, SessionStorageKey: S } =
  await import('@/helpers/storage');
const { DisconnectCode } = await import('@dodecagon/shared');
const { joinVoice, addUserToVoiceChannel, removeUserFromVoiceChannel } =
  await import('../voice/actions');
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let elapsed = 0;
let nextTimer = 1;
const timers = new Map<number, { callback: () => unknown; delay: number }>();
const outage = { code: 1006, reason: '', wasClean: false, time: new Date() };
const tick = async () => {
  const entry = timers.entries().next().value;
  if (!entry) throw new Error('Expected another recovery attempt');
  const [id, timer] = entry;
  timers.delete(id);
  elapsed += timer.delay;
  await timer.callback();
};

beforeEach(() => {
  online = true;
  rateLimited = false;
  authError = undefined;
  passwordRequired = false;
  servedVersion = '0.0.65';
  lastToken = '';
  elapsed = 0;
  reloads = 0;
  joinBarrier = undefined;
  onJoin = undefined;
  local.clear();
  session.clear();
  timers.clear();
  Object.assign(globalThis, {
    setTimeout: (callback: () => unknown, delay: number) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    }
  });
  store.setState({
    server: {
      ...serverInitialState,
      info: {
        serverId: 'test',
        name: 'Test',
        description: '',
        allowNewUsers: true,
        logo: null,
        oidcEnabled: false,
        oidcDisableLocalLogin: false
      }
    }
  });
  session.setItem(S.TOKEN, 'same-tab-token');
});
afterEach(() => {
  cleanup();
  Object.assign(globalThis, {
    setTimeout: realSetTimeout,
    clearTimeout: realClearTimeout
  });
});

test('a restart lasting over 25 seconds keeps credentials and restores the same account automatically', async () => {
  local.setItem(L.AUTO_LOGIN_TOKEN, 'remembered-token');
  local.setItem(L.AUTO_LOGIN, 'true');
  await connect();
  setServerUpdateState({ phase: 'restarting', targetVersion: '0.0.66' });
  online = false;
  reconnectToServer(outage);
  for (let i = 0; i < 8; i++) await tick();
  expect(elapsed).toBeGreaterThan(25_000);
  expect(store.getState().server.reconnect).not.toBeNull();
  expect(store.getState().server.updateState?.phase).toBe('restarting');
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  expect(local.getItem(L.AUTO_LOGIN_TOKEN)).toBe('remembered-token');
  online = true;
  await tick();
  expect(store.getState().server.connected).toBe(true);
  expect(store.getState().server.ownUserId).toBe(7);
  expect(lastToken).toBe('same-tab-token');
  expect(reloads).toBe(0);
});

test('a same-tab reload resumes the current token even when remembered login is off', async () => {
  local.setItem(L.AUTO_LOGIN, 'false');
  expect(await resumeSession()).toBe(true);
  expect(store.getState().server.connected).toBe(true);
  expect(lastToken).toBe('same-tab-token');
  expect(local.getItem(L.AUTO_LOGIN)).toBe('false');
});

test('transient failure during saved login enters recovery without deleting the saved credential', async () => {
  session.clear();
  local.setItem(L.AUTO_LOGIN, 'true');
  local.setItem(L.AUTO_LOGIN_TOKEN, 'saved-token');
  online = false;
  await resumeSession();
  expect(session.getItem(S.TOKEN)).toBe('saved-token');
  expect(local.getItem(L.AUTO_LOGIN_TOKEN)).toBe('saved-token');
  expect(store.getState().server.reconnect).not.toBeNull();
  online = true;
  await tick();
  expect(store.getState().server.ownUserId).toBe(7);
});

test('an actually revoked credential terminates recovery and removes both credentials', async () => {
  await connect();
  local.setItem(L.AUTO_LOGIN, 'true');
  local.setItem(L.AUTO_LOGIN_TOKEN, 'saved-token');
  authError = 'UNAUTHORIZED';
  reconnectToServer(outage);
  await tick();
  expect(store.getState().server.reconnect).toBeNull();
  expect(session.getItem(S.TOKEN)).toBeNull();
  expect(local.getItem(L.AUTO_LOGIN_TOKEN)).toBeNull();
  expect(local.getItem(L.AUTO_LOGIN)).toBe('false');
});

test('server-password or stale-handshake rejection does not discard a valid account credential', async () => {
  await connect();
  authError = 'FORBIDDEN';
  reconnectToServer(outage);
  await tick();
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  expect(store.getState().server.reconnect).not.toBeNull();
  authError = undefined;
  await tick();
  expect(store.getState().server.connected).toBe(true);
});

test('explicit logout cancels recovery and removes credentials', async () => {
  await connect();
  online = false;
  reconnectToServer(outage);
  disconnectFromServer();
  expect(session.getItem(S.TOKEN)).toBeNull();
  expect(store.getState().server.reconnect).toBeNull();
  expect(store.getState().server.connected).toBe(false);
});

test('cancelling a server-password prompt keeps valid account credentials', async () => {
  passwordRequired = true;
  local.setItem(L.AUTO_LOGIN, 'true');
  local.setItem(L.AUTO_LOGIN_TOKEN, 'saved-token');
  await resumeSession();
  cleanup({ invalidateCredentials: false });
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  expect(local.getItem(L.AUTO_LOGIN_TOKEN)).toBe('saved-token');
  expect(store.getState().server.connected).toBe(false);
  expect(store.getState().server.reconnect).toBeNull();
});

test('signing out while join is pending cannot restore the signed-out session later', async () => {
  const gate = Promise.withResolvers<void>();
  const joining = Promise.withResolvers<void>();
  joinBarrier = gate.promise;
  onJoin = joining.resolve;
  const resumed = resumeSession();
  await joining.promise;
  disconnectFromServer();
  gate.resolve();
  await resumed;
  expect(session.getItem(S.TOKEN)).toBeNull();
  expect(store.getState().server.connected).toBe(false);
  expect(store.getState().server.reconnect).toBeNull();
});

test('a delayed old-socket close cannot kick a newly restored session', async () => {
  await connect();
  const oldSocket = wsOptions;
  oldSocket.onClose({ code: 1006, reason: '', wasClean: false });
  await tick();
  oldSocket.onClose({
    code: DisconnectCode.KICKED,
    reason: 'Old connection',
    wasClean: true
  });
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  expect(store.getState().server.ownUserId).toBe(7);
  expect(store.getState().server.connected).toBe(true);
});

test('a response arriving on a dead socket cannot claim recovery or cancel the next join', async () => {
  const gate = Promise.withResolvers<void>();
  const joining = Promise.withResolvers<void>();
  joinBarrier = gate.promise;
  onJoin = joining.resolve;
  const resumed = resumeSession();
  await joining.promise;
  wsOptions.onClose({ code: 1006, reason: '', wasClean: false });
  gate.resolve();
  await resumed;
  expect(store.getState().server.connected).toBe(false);
  expect(store.getState().server.reconnect).not.toBeNull();
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  joinBarrier = undefined;
  onJoin = undefined;
  await tick();
  expect(store.getState().server.connected).toBe(true);
  expect(store.getState().server.ownUserId).toBe(7);
});

for (const code of [
  DisconnectCode.KICKED,
  DisconnectCode.BANNED,
  DisconnectCode.AUTHENTICATION_FAILED
]) {
  test(`terminal close ${code} never resumes a removed account session`, async () => {
    await connect();
    wsOptions.onClose({ code, reason: 'Removed by moderator', wasClean: true });
    expect(session.getItem(S.TOKEN)).toBeNull();
    expect(store.getState().server.connected).toBe(false);
    expect(store.getState().server.reconnect).toBeNull();
    expect(store.getState().server.disconnectInfo?.code).toBe(code);
  });
}

test('observed new served version refreshes the client once without losing the same-tab token', async () => {
  await connect();
  setServerUpdateState({ phase: 'restarting', targetVersion: '0.0.66' });
  servedVersion = '0.0.66';
  reconnectToServer(outage);
  await tick();
  expect(reloads).toBe(1);
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
  await connect();
  expect(reloads).toBe(1);
  cancelReconnect();
});

test('a version the client already reloaded for is not reloaded again after the tab storage is gone', async () => {
  await connect();
  servedVersion = '0.0.66';
  reconnectToServer(outage);
  await tick();
  expect(reloads).toBe(1);

  // the document reload drops the storage of the tab, and a browser can refuse it outright.
  // the record of the last reload has to outlive both, or the same version reloads forever
  session.clear();
  await connect();
  expect(reloads).toBe(1);
  cancelReconnect();
});

test('a version published while the last reload is fresh waits for the next minute', async () => {
  await connect();
  servedVersion = '0.0.66';
  reconnectToServer(outage);
  await tick();
  expect(reloads).toBe(1);

  servedVersion = '0.0.67';
  await connect();
  expect(reloads).toBe(1);
  cancelReconnect();
});

test('a rate-limited reconnection waits out the window instead of climbing the ladder', async () => {
  await connect();
  rateLimited = true;
  reconnectToServer(outage);

  await tick();
  expect(elapsed).toBe(1_000);
  expect(store.getState().server.reconnect).not.toBeNull();

  // the recovery ladder would ask again in two seconds and keep the count of the server
  // spent, so the refused attempt waits the length of the window instead
  await tick();
  expect(elapsed).toBe(31_000);

  await tick();
  expect(elapsed).toBe(61_000);

  rateLimited = false;
  await tick();
  expect(store.getState().server.connected).toBe(true);
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
});

test('a rate-limited first attempt after a reload waits for the window', async () => {
  rateLimited = true;
  await resumeSession();

  expect(store.getState().server.reconnect).not.toBeNull();

  // the retry is scheduled for the length of the window rather than for the first step of
  // the ladder, so one wait is enough for the server to accept the session again
  rateLimited = false;
  await tick();
  expect(elapsed).toBe(30_000);
  expect(store.getState().server.connected).toBe(true);
  expect(session.getItem(S.TOKEN)).toBe('same-tab-token');
});

const voiceState = {
  micMuted: false,
  soundMuted: false,
  webcamEnabled: false,
  sharingScreen: false
};

test('a delayed old departure cannot cancel the pending or completed replacement voice join', async () => {
  await connect();
  const gate = Promise.withResolvers<void>();
  joinBarrier = gate.promise;
  const pending = joinVoice(2);
  removeUserFromVoiceChannel(7, 2, 'departed-session');
  expect(store.getState().server.currentVoiceChannelId).toBe(2);
  addUserToVoiceChannel(7, 2, voiceState);
  gate.resolve();
  await pending;
  removeUserFromVoiceChannel(7, 2, 'departed-session');
  expect(store.getState().server.currentVoiceChannelId).toBe(2);
  expect(store.getState().server.voiceMap[2]?.users[7]).toEqual(voiceState);
  removeUserFromVoiceChannel(7, 2, joinedVoiceSessionId);
  expect(store.getState().server.currentVoiceChannelId).toBeUndefined();
  expect(store.getState().server.voiceMap[2]?.users[7]).toBeUndefined();
});

test('a genuine voice departure ends our call and remote departures still update peers', async () => {
  await connect();
  await joinVoice(2);
  addUserToVoiceChannel(7, 2, voiceState);
  addUserToVoiceChannel(8, 2, voiceState);
  removeUserFromVoiceChannel(8, 2, 'remote-session');
  expect(store.getState().server.voiceMap[2]?.users[8]).toBeUndefined();
  expect(store.getState().server.currentVoiceChannelId).toBe(2);
  removeUserFromVoiceChannel(7, 2, joinedVoiceSessionId);
  expect(store.getState().server.currentVoiceChannelId).toBeUndefined();
});
