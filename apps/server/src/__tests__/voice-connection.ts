import type { TVoiceConnection } from '../runtimes/voice';

// Legacy route fixtures model one authenticated connection per account. Tests using
// real/fake sockets receive distinct connection identities from createContext instead.
//
// the map lives on the global object because the preloaded setup and a test file
// can hold different copies of this module: a reset that ran in one copy used to
// leave the other one with a connection a previous test had already superseded,
// which failed every later test that joined voice on that account
type TVoiceConnectionStore = typeof globalThis & {
  testVoiceConnections?: Map<number, TVoiceConnection>;
};

const connections = (): Map<number, TVoiceConnection> => {
  const store = globalThis as TVoiceConnectionStore;

  store.testVoiceConnections ??= new Map<number, TVoiceConnection>();

  return store.testVoiceConnections;
};

const resetTestVoiceConnections = (): void => {
  connections().clear();
};

const getTestVoiceConnection = (userId: number): TVoiceConnection => {
  const store = connections();
  let connection = store.get(userId);

  if (!connection) {
    connection = { closed: false, superseded: false };
    store.set(userId, connection);
  }

  return connection;
};

export { getTestVoiceConnection, resetTestVoiceConnections };
