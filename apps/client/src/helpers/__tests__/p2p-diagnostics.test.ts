import { beforeEach, expect, test } from 'bun:test';
import {
  beginP2PDiagnostic,
  buildP2PDiagnosticEvent,
  finishP2PDiagnostic,
  getP2PDiagnostic,
  getP2PDiagnosticsSnapshot,
  markP2PPhase,
  resetP2PDiagnostics,
  setP2PSession,
  shouldReportP2PDiagnostic,
  type TP2PDiagnosticRecord
} from '../p2p-diagnostics';

beforeEach(() => {
  resetP2PDiagnostics();
});

test('records phase durations without exposing the session identifier', () => {
  const ref = beginP2PDiagnostic({
    kind: 'audio',
    role: 'sender',
    at: 1_000
  });
  setP2PSession(ref, '123e4567-e89b-42d3-a456-426614174000');
  markP2PPhase(ref, 'native_created', 1_900);
  markP2PPhase(ref, 'offer_sent', 2_100);
  const record = finishP2PDiagnostic(
    ref,
    { outcome: 'relay', reason: 'native_closed_early' },
    3_500
  );

  expect(record?.sessionRef).toBe('123e4567e89b');
  expect(record?.sessionRef).not.toContain('123e4567-e89b');
  expect(record?.durationMs).toBe(2_500);
  expect(record?.phases).toEqual([
    { phase: 'native_created', atMs: 900 },
    { phase: 'offer_sent', atMs: 1_100 }
  ]);
});

test('keeps only the latest bounded records', () => {
  for (let index = 0; index < 70; index++) {
    const ref = beginP2PDiagnostic({
      kind: 'video',
      role: 'receiver',
      at: index
    });
    finishP2PDiagnostic(ref, { outcome: 'direct' }, index + 1);
  }

  const records = getP2PDiagnosticsSnapshot(100);
  expect(records).toHaveLength(64);
  expect(records[0]?.outcome).toBe('direct');
});

test('finishing twice keeps the first terminal reason', () => {
  const ref = beginP2PDiagnostic({ kind: 'screen', role: 'sender', at: 0 });
  finishP2PDiagnostic(
    ref,
    { outcome: 'relay', reason: 'negotiation_timeout' },
    10
  );
  finishP2PDiagnostic(ref, { outcome: 'direct' }, 20);

  expect(getP2PDiagnostic(ref)).toMatchObject({
    outcome: 'relay',
    reason: 'negotiation_timeout',
    durationMs: 10
  });
});

test('reports only actionable failures', () => {
  const record = (
    outcome: TP2PDiagnosticRecord['outcome'],
    reason: TP2PDiagnosticRecord['reason']
  ): TP2PDiagnosticRecord => ({
    ref: 'a1',
    kind: 'audio',
    role: 'sender',
    startedAt: 0,
    phases: [],
    outcome,
    reason
  });

  expect(
    shouldReportP2PDiagnostic(record('relay', 'native_closed_early'))
  ).toBe(true);
  expect(
    shouldReportP2PDiagnostic(record('failed', 'negotiation_timeout'))
  ).toBe(true);
  expect(shouldReportP2PDiagnostic(record('relay', 'session_declined'))).toBe(
    true
  );
  expect(shouldReportP2PDiagnostic(record('relay', 'unwatch'))).toBe(false);
  expect(shouldReportP2PDiagnostic(record('relay', 'bridge_absent'))).toBe(
    false
  );
  expect(shouldReportP2PDiagnostic(record('direct', 'media_delivered'))).toBe(
    false
  );
});

test('builds a tracker event with codes and timings but no identity or free text', () => {
  const ref = beginP2PDiagnostic({ kind: 'screen', role: 'receiver', at: 0 });
  setP2PSession(ref, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  markP2PPhase(ref, 'offer_received', 50);
  markP2PPhase(ref, 'native_connect', 1_250);
  const record = finishP2PDiagnostic(
    ref,
    { outcome: 'relay', reason: 'native_connect_failed' },
    9_000
  );
  if (!record) throw new Error('record missing');

  const event = buildP2PDiagnosticEvent(record);
  const serialized = JSON.stringify(event);

  expect(event.tags).toEqual({
    area: 'voice',
    'p2p.kind': 'screen',
    'p2p.role': 'receiver',
    'p2p.outcome': 'relay',
    'p2p.reason': 'native_connect_failed'
  });
  expect(event.contexts.p2p).toMatchObject({
    session_ref: 'aaaaaaaabbbb',
    duration_ms: 9_000,
    phases: 'offer_received:50,native_connect:1250'
  });
  expect(serialized).not.toContain('aaaaaaaa-bbbb');
  expect(serialized).not.toContain('192.168.');
  expect(serialized).not.toContain('v=0');
});
