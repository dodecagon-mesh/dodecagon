import { expect, test } from 'bun:test';
import {
  buildDirectMediaDiagnostic,
  buildDirectMediaDiagnosticEvent,
  shouldReportDirectMediaDiagnostic
} from '../direct-media-diagnostics';

test('a timed-out session carries the ref, phase timings and the failure code', () => {
  const diagnostic = buildDirectMediaDiagnostic({
    sessionId: '123e4567-e89b-42d3-a456-426614174000',
    kind: 'audio',
    startedAt: 1_000,
    offeredAt: 1_400,
    answeredAt: 2_600,
    endedAt: 5_500,
    reason: 'deadline',
    latched: true,
    relayRestore: true
  });

  expect(diagnostic).toEqual({
    ref: '123e4567e89b',
    kind: 'audio',
    outcome: 'failed',
    reason: 'deadline',
    reached_ready: false,
    latched: true,
    relay_restore: true,
    duration_ms: 4_500,
    offer_ms: 400,
    answer_ms: 1_600
  });
  expect(shouldReportDirectMediaDiagnostic(diagnostic)).toBe(true);

  const event = buildDirectMediaDiagnosticEvent(diagnostic);
  expect(event.tags).toEqual({
    area: 'voice',
    'p2p.kind': 'audio',
    'p2p.role': 'sender',
    'p2p.outcome': 'failed',
    'p2p.reason': 'deadline'
  });
  expect(event.contexts.p2p).toMatchObject({
    session_ref: '123e4567e89b',
    duration_ms: 4_500,
    offer_ms: 400,
    answer_ms: 1_600
  });
});

test('a ready session that ended normally is not an incident', () => {
  const diagnostic = buildDirectMediaDiagnostic({
    sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    kind: 'screen',
    startedAt: 0,
    offeredAt: 200,
    answeredAt: 900,
    readyAt: 1_800,
    endedAt: 60_000,
    reason: 'stop',
    latched: false,
    relayRestore: false
  });

  expect(diagnostic.outcome).toBe('stopped');
  expect(diagnostic.reached_ready).toBe(true);
  expect(diagnostic.ready_ms).toBe(1_800);
  expect(shouldReportDirectMediaDiagnostic(diagnostic)).toBe(false);
});
