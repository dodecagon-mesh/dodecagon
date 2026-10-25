import { beforeEach } from 'bun:test';
import type { TVoiceConnection } from '../runtimes/voice';

// Legacy route fixtures model one authenticated connection per account. Tests using
// real/fake sockets receive distinct connection identities from createContext instead.
const connections = new Map<number, TVoiceConnection>();
beforeEach(() => connections.clear());

export const getTestVoiceConnection = (userId: number): TVoiceConnection => {
  let connection = connections.get(userId);
  if (!connection) {
    connection = { closed: false, superseded: false };
    connections.set(userId, connection);
  }
  return connection;
};
