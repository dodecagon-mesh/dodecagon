import { StreamKind } from '@dodecagon/shared';
import { expect, test } from 'bun:test';
import {
  beginP2PDiagnostic,
  finishP2PDiagnostic,
  markP2PPhase,
  resetP2PDiagnostics,
  setP2PSession
} from '../p2p-diagnostics';
import {
  collectVoiceDebugSnapshot,
  createVoiceDebugReport,
  registerVoiceDebugSource
} from '../voice-debug';

const connection = (stats: object[]) =>
  ({
    connectionState: 'connected',
    iceConnectionState: 'connected',
    signalingState: 'stable',
    getStats: async () => {
      return new Map(stats.map((stat, index) => [String(index), stat]));
    }
  }) as unknown as RTCPeerConnection;

test('copy report carries P2P reason codes and phases without the session id', async () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  resetP2PDiagnostics();
  const ref = beginP2PDiagnostic({
    kind: 'audio',
    role: 'sender',
    at: 0
  });
  setP2PSession(ref, sessionId);
  markP2PPhase(ref, 'native_created', 500);
  finishP2PDiagnostic(
    ref,
    { outcome: 'relay', reason: 'native_closed_early' },
    3_000
  );

  try {
    const snapshot = await collectVoiceDebugSnapshot();
    const report = createVoiceDebugReport(snapshot, []);

    expect(report).toContain('native_closed_early');
    expect(report).toContain('"duration_ms": 3000');
    expect(report).toContain('"session_ref": "123e4567e89b"');
    expect(report).not.toContain(sessionId);
  } finally {
    resetP2PDiagnostics();
  }
});

test('copy report retains media counters but excludes network addresses and secrets even in events and errors', async () => {
  const unregister = registerVoiceDebugSource(() => ({
    producers: [],
    consumers: [],
    directConnections: [
      {
        peerId: 424242,
        kind: StreamKind.AUDIO,
        direction: 'incoming',
        connection: connection([
          {
            type: 'inbound-rtp',
            id: '192.0.2.1',
            bytesReceived: 456,
            packetsLost: 3
          },
          {
            type: 'local-candidate',
            address: '192.0.2.1',
            port: 1234,
            usernameFragment: 'secret-key',
            url: 'turn:192.0.2.1'
          }
        ])
      }
    ]
  }));
  try {
    const snapshot = await collectVoiceDebugSnapshot();
    snapshot.collectErrors.push('192.0.2.1 secret-key');
    const report = createVoiceDebugReport(snapshot, [
      {
        id: 1,
        at: 1,
        category: 'error',
        message: '192.0.2.1',
        data: 'secret-key'
      }
    ]);
    expect(report).toContain('"bytesReceived": 456');
    expect(report).toContain('"packetsLost": 3');
    expect(report).not.toContain('192.0.2.1');
    expect(report).not.toContain('secret-key');
    expect(report).not.toContain('1234');
    expect(report).not.toContain('424242');
  } finally {
    unregister();
  }
});
