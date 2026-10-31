import { beforeEach } from 'bun:test';
import type { TVoiceConnection } from '../runtimes/voice';

// Legacy route fixtures model one authenticated connection per account. Tests using
// real/fake sockets receive distinct connection identities from createContext instead.
const connections = new Map<number, TVoiceConnection>();
beforeEach(() => connections.clear());

const origin = new Map<TVoiceConnection, string>();

const createConnection = (userId: number): TVoiceConnection => {
  const state = { closed: false, superseded: false };
  const connection = {
    get closed() {
      return state.closed;
    },
    set closed(value: boolean) {
      if (value && !origin.has(connection)) {
        origin.set(
          connection,
          new Error(`closed for ${userId}`).stack ?? 'no stack'
        );
      }
      state.closed = value;
    },
    get superseded() {
      return state.superseded;
    },
    set superseded(value: boolean) {
      if (value && !origin.has(connection)) {
        origin.set(
          connection,
          new Error(`superseded for ${userId}`).stack ?? 'no stack'
        );
      }
      state.superseded = value;
    }
  } as TVoiceConnection;
  return connection;
};

export const getTestVoiceConnection = (userId: number): TVoiceConnection => {
  let connection = connections.get(userId);
  if (!connection) {
    connection = createConnection(userId);
    connections.set(userId, connection);
  }
  if (connection.closed || connection.superseded) {
    process.stdout.write(
      `[stub] user ${userId} handed out closed=${connection.closed} superseded=${connection.superseded}\n${origin.get(connection) ?? 'no origin'}\n`
    );
  }
  return connection;
};
