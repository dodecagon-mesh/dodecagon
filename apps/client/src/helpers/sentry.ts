import type { ErrorEvent } from '@sentry/react';
import * as Sentry from '@sentry/react';

type TTrackerDiagnostic = {
  level: 'warning';
  message: string;
  tags: Record<string, string>;
  contexts: { p2p: Record<string, unknown> };
  fingerprint: string[];
};

let enabled = false;
let currentDsn: string | undefined;

// only our own namespaced tags are safe to attach; anything else may carry a
// URL, a token, a user label or a free-form message
const SAFE_TAG = /^(?:area|p2p\.[a-z0-9_.-]+)$/i;

const initSentry = (
  dsn: string | undefined,
  environment?: string,
  release?: string
) => {
  if (!dsn) return;
  if (dsn === currentDsn && Sentry.getClient()) return;
  currentDsn = dsn;

  Sentry.init({
    dsn,
    environment: environment ?? 'development',
    ...(release ? { release } : {}),
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent): ErrorEvent => ({
      ...event,
      request: undefined,
      user: undefined,
      extra: undefined,
      // keep only the contexts the tracker needs to interpret a P2P failure:
      // our allowlisted timeline plus the browser and OS versions. Everything
      // else can contain chat text, URLs or transport details.
      contexts: event.contexts
        ? {
            ...(event.contexts.browser
              ? { browser: event.contexts.browser }
              : {}),
            ...(event.contexts.os ? { os: event.contexts.os } : {}),
            ...(event.contexts.p2p ? { p2p: event.contexts.p2p } : {})
          }
        : undefined,
      tags: Object.fromEntries(
        Object.entries(event.tags ?? {}).filter(([key]) => SAFE_TAG.test(key))
      ),
      // breadcrumbs keep their shape so the timeline stays useful, never the
      // console text or data that produced them
      breadcrumbs: event.breadcrumbs?.map(({ category, level, timestamp }) => ({
        category,
        level,
        timestamp
      }))
    })
  });

  enabled = true;
};

// every path that can carry a dsn — the boot of the page, the public settings of
// the server, a later reconnection — reports under the same environment and
// release. a dsn that the server sends used to re-open the client with the sdk
// default ('development') and without a release, which mislabels every browser
// event of a production deployment. vite bakes the three constants at build
// time; the typeof guards keep the client tests running where it defines none
const initAppSentry = (dsn?: string | null) =>
  initSentry(
    dsn ||
      (typeof VITE_SENTRY_DSN === 'undefined' ? undefined : VITE_SENTRY_DSN),
    typeof VITE_SENTRY_ENVIRONMENT === 'undefined'
      ? undefined
      : VITE_SENTRY_ENVIRONMENT,
    typeof VITE_APP_VERSION === 'undefined' ? undefined : VITE_APP_VERSION
  );

const captureError = (error: unknown, tags?: Record<string, string>) => {
  if (!enabled) return;

  Sentry.captureException(error, tags ? { tags } : undefined);
};

const captureDiagnostic = (event: TTrackerDiagnostic) => {
  if (!enabled) return;

  Sentry.captureEvent({
    level: event.level,
    message: event.message,
    tags: event.tags,
    contexts: event.contexts,
    fingerprint: event.fingerprint
  });
};

export { captureDiagnostic, captureError, initAppSentry, initSentry };
