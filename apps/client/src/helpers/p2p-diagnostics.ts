import { captureDiagnostic } from './sentry';

const MAX_RECORDS = 64;

export type TP2PKind = 'audio' | 'video' | 'screen';
export type TP2PRole = 'sender' | 'receiver';
export type TP2POutcome = 'direct' | 'relay' | 'failed' | 'stopped';
export type TP2PPhase =
  | 'attempt'
  | 'session'
  | 'native_created'
  | 'offer_received'
  | 'offer_sent'
  | 'answer_received'
  | 'answer_sent'
  | 'sdp_remote'
  | 'native_connect'
  | 'peer_connected'
  | 'ready_sent'
  | 'ready_received'
  | 'media_delivered';
export type TP2PReason =
  | 'media_delivered'
  | 'bridge_absent'
  | 'session_declined'
  | 'session_retired'
  | 'session_kind_mismatch'
  | 'native_create_failed'
  | 'native_connect_failed'
  | 'native_closed_early'
  | 'native_closed_established'
  | 'negotiation_timeout'
  | 'delivery_timeout'
  | 'peer_connection_failed'
  | 'peer_connection_disconnected'
  | 'peer_connection_closed'
  | 'signal_rejected'
  | 'signal_failed'
  | 'track_mismatch'
  | 'remote_fallback'
  | 'remote_stop'
  | 'unwatch'
  | 'stopped'
  | 'unknown';

export type TP2PDiagnosticRecord = {
  ref: string;
  sessionRef?: string;
  kind: TP2PKind;
  role: TP2PRole;
  startedAt: number;
  phases: { phase: TP2PPhase; atMs: number }[];
  outcome?: TP2POutcome;
  reason?: TP2PReason;
  durationMs?: number;
};

export type TP2PDiagnosticEvent = {
  level: 'warning';
  message: 'voice.p2p';
  tags: Record<string, string>;
  contexts: { p2p: Record<string, unknown> };
  fingerprint: string[];
};

const records = new Map<string, TP2PDiagnosticRecord>();
let sequence = 0;

// the session id is a random server UUID, not an identity. keeping a stable
// prefix still lets the server log, both peers and the native bridge line up.
const sessionRef = (sessionId: string) =>
  sessionId.replace(/-/g, '').slice(0, 12);

const prune = () => {
  while (records.size > MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) return;
    records.delete(oldest);
  }
};

const beginP2PDiagnostic = (options: {
  kind: TP2PKind;
  role: TP2PRole;
  sessionId?: string;
  at?: number;
}): string => {
  const ref = `p${++sequence}`;
  records.set(ref, {
    ref,
    ...(options.sessionId ? { sessionRef: sessionRef(options.sessionId) } : {}),
    kind: options.kind,
    role: options.role,
    startedAt: options.at ?? Date.now(),
    phases: []
  });
  prune();
  return ref;
};

const setP2PSession = (ref: string, sessionId: string): void => {
  const record = records.get(ref);
  if (record) record.sessionRef = sessionRef(sessionId);
};

const markP2PPhase = (ref: string, phase: TP2PPhase, at = Date.now()): void => {
  const record = records.get(ref);
  if (!record || record.phases.some((entry) => entry.phase === phase)) return;
  record.phases.push({
    phase,
    atMs: Math.max(0, Math.round(at - record.startedAt))
  });
};

const finishP2PDiagnostic = (
  ref: string,
  terminal: { outcome: TP2POutcome; reason?: TP2PReason },
  at = Date.now()
): TP2PDiagnosticRecord | undefined => {
  const record = records.get(ref);
  if (!record) return undefined;
  if (record.outcome) return { ...record, phases: [...record.phases] };
  record.outcome = terminal.outcome;
  if (terminal.reason) record.reason = terminal.reason;
  record.durationMs = Math.max(0, Math.round(at - record.startedAt));
  return { ...record, phases: [...record.phases] };
};

const getP2PDiagnostic = (ref: string): TP2PDiagnosticRecord | undefined => {
  const record = records.get(ref);
  return record ? { ...record, phases: [...record.phases] } : undefined;
};

const getP2PDiagnosticsSnapshot = (limit = 16): TP2PDiagnosticRecord[] =>
  Array.from(records.values())
    .slice(-Math.max(1, limit))
    .map((record) => ({ ...record, phases: [...record.phases] }));

const BENIGN_REASONS: Partial<Record<TP2PReason, true>> = {
  media_delivered: true,
  bridge_absent: true,
  session_retired: true,
  remote_stop: true,
  unwatch: true,
  stopped: true
};

const shouldReportP2PDiagnostic = (record: TP2PDiagnosticRecord): boolean =>
  (record.outcome === 'relay' || record.outcome === 'failed') &&
  (!record.reason || !BENIGN_REASONS[record.reason]);

const buildP2PDiagnosticEvent = (
  record: TP2PDiagnosticRecord
): TP2PDiagnosticEvent => ({
  level: 'warning',
  message: 'voice.p2p',
  tags: {
    area: 'voice',
    'p2p.kind': record.kind,
    'p2p.role': record.role,
    'p2p.outcome': record.outcome ?? 'unknown',
    'p2p.reason': record.reason ?? 'unknown'
  },
  contexts: {
    p2p: {
      schema: 1,
      session_ref: record.sessionRef ?? null,
      kind: record.kind,
      role: record.role,
      outcome: record.outcome ?? null,
      reason: record.reason ?? null,
      duration_ms: record.durationMs ?? null,
      // Sentry normalizes nested objects in contexts to "[Object]", so the
      // timeline travels as one bounded scalar instead of losing its values.
      phases: record.phases
        .map(({ phase, atMs }) => `${phase}:${atMs}`)
        .join(',')
    }
  },
  fingerprint: [
    'voice.p2p',
    record.kind,
    record.role,
    record.outcome ?? 'unknown',
    record.reason ?? 'unknown'
  ]
});

const reportP2PDiagnostic = (
  record: TP2PDiagnosticRecord | undefined
): void => {
  if (!record || !shouldReportP2PDiagnostic(record)) return;
  captureDiagnostic(buildP2PDiagnosticEvent(record));
};

const resetP2PDiagnostics = (): void => {
  records.clear();
  sequence = 0;
};

export {
  beginP2PDiagnostic,
  buildP2PDiagnosticEvent,
  finishP2PDiagnostic,
  getP2PDiagnostic,
  getP2PDiagnosticsSnapshot,
  markP2PPhase,
  reportP2PDiagnostic,
  resetP2PDiagnostics,
  sessionRef,
  setP2PSession,
  shouldReportP2PDiagnostic
};
