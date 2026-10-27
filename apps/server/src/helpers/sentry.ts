import * as Sentry from '@sentry/bun';
import { TRPCError } from '@trpc/server';
import { SERVER_VERSION } from '../utils/env';

type TTrackerDiagnostic = {
  level: 'warning';
  message: string;
  tags: Record<string, string>;
  contexts: { p2p: Record<string, unknown> };
  fingerprint: string[];
};

const SAFE_TAG = /^(?:area|p2p\.[a-z0-9_.-]+)$/i;

const initSentry = () => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
    release: SERVER_VERSION,
    tracesSampleRate: 0,
    beforeSend: (event) => ({
      ...event,
      request: undefined,
      user: undefined,
      extra: undefined,
      contexts: event.contexts?.p2p ? { p2p: event.contexts.p2p } : undefined,
      tags: Object.fromEntries(
        Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAG.test(key))
      ),
      breadcrumbs: event.breadcrumbs?.map(({ category, level, timestamp }) => ({
        category,
        level,
        timestamp
      }))
    })
  });
};

const shouldReportError = (error: unknown) => {
  if (!(error instanceof TRPCError)) return true;

  return error.code === 'INTERNAL_SERVER_ERROR';
};

const captureError = (error: unknown, tags?: Record<string, string>) => {
  if (!Sentry.getClient()) return;

  Sentry.captureException(error, tags ? { tags } : undefined);
};

const captureDiagnostic = (event: TTrackerDiagnostic) => {
  if (!Sentry.getClient()) return;

  Sentry.captureEvent({
    level: event.level,
    message: event.message,
    tags: event.tags,
    contexts: event.contexts,
    fingerprint: event.fingerprint
  });
};

export { captureDiagnostic, captureError, initSentry, shouldReportError };
