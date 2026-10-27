type TDirectMediaDiagnosticInput = {
  sessionId: string;
  kind: string;
  startedAt: number;
  offeredAt?: number;
  answeredAt?: number;
  readyAt?: number;
  endedAt: number;
  reason: 'deadline' | 'fallback' | 'stop' | 'unwatch';
  latched: boolean;
  relayRestore: boolean;
};

type TDirectMediaDiagnostic = {
  ref: string;
  kind: string;
  outcome: 'ready' | 'stopped' | 'failed';
  reason: TDirectMediaDiagnosticInput['reason'];
  reached_ready: boolean;
  latched: boolean;
  relay_restore: boolean;
  duration_ms: number;
  offer_ms?: number;
  answer_ms?: number;
  ready_ms?: number;
};

const STOP_REASONS: Partial<
  Record<TDirectMediaDiagnosticInput['reason'], true>
> = {
  stop: true,
  unwatch: true
};

const buildDirectMediaDiagnostic = (
  input: TDirectMediaDiagnosticInput
): TDirectMediaDiagnostic => {
  const stopped = !!STOP_REASONS[input.reason];
  const reachedReady = input.readyAt !== undefined;
  return {
    ref: input.sessionId.replace(/-/g, '').slice(0, 12),
    kind: input.kind,
    outcome: stopped
      ? 'stopped'
      : reachedReady && !input.latched
        ? 'ready'
        : 'failed',
    reason: input.reason,
    reached_ready: reachedReady,
    latched: input.latched,
    relay_restore: input.relayRestore,
    duration_ms: Math.max(0, Math.round(input.endedAt - input.startedAt)),
    ...(input.offeredAt !== undefined
      ? { offer_ms: Math.max(0, Math.round(input.offeredAt - input.startedAt)) }
      : {}),
    ...(input.answeredAt !== undefined
      ? {
          answer_ms: Math.max(0, Math.round(input.answeredAt - input.startedAt))
        }
      : {}),
    ...(input.readyAt !== undefined
      ? { ready_ms: Math.max(0, Math.round(input.readyAt - input.startedAt)) }
      : {})
  };
};

const shouldReportDirectMediaDiagnostic = (
  diagnostic: TDirectMediaDiagnostic
): boolean => diagnostic.outcome === 'failed';

const buildDirectMediaDiagnosticEvent = (
  diagnostic: TDirectMediaDiagnostic
) => ({
  level: 'warning' as const,
  message: 'voice.p2p',
  tags: {
    area: 'voice',
    'p2p.kind': diagnostic.kind,
    'p2p.role': 'sender',
    'p2p.outcome': diagnostic.outcome,
    'p2p.reason': diagnostic.reason
  },
  contexts: {
    p2p: {
      schema: 1,
      session_ref: diagnostic.ref,
      ...diagnostic
    }
  },
  fingerprint: [
    'voice.p2p',
    diagnostic.kind,
    'sender',
    diagnostic.outcome,
    diagnostic.reason
  ]
});

export {
  buildDirectMediaDiagnostic,
  buildDirectMediaDiagnosticEvent,
  shouldReportDirectMediaDiagnostic
};
export type { TDirectMediaDiagnostic, TDirectMediaDiagnosticInput };
