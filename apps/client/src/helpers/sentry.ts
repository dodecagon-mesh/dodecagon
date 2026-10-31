import type * as SentryModule from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';

type TSentryModule = typeof SentryModule;

type TTrackerDiagnostic = {
  level: 'warning' | 'info';
  message: string;
  tags: Record<string, string>;
  contexts: {
    p2p?: Record<string, unknown>;
    network?: Record<string, unknown>;
  };
  fingerprint: string[];
};

let sentry: TSentryModule | undefined;
let sentryPromise: Promise<TSentryModule> | undefined;
let enabled = false;
let currentDsn: string | undefined;

// only our own namespaced tags are safe to attach; anything else may carry a
// URL, a token, a user label or a free-form message
const SAFE_TAG = /^(?:area|p2p\.[a-z0-9_.-]+|network\.[a-z0-9_.-]+)$/i;

const initSentry = async (
  dsn: string | undefined,
  environment?: string,
  release?: string
) => {
  if (!dsn) return;
  if (dsn === currentDsn && sentry?.getClient()) return;

  // the sdk is a third of the startup javascript, a deployment without a dsn
  // must never download it. the first error before the chunk arrives is lost,
  // which is the same window the old synchronous init had before it ran
  sentryPromise ??= import('@sentry/react');

  const module = await sentryPromise;

  sentry = module;

  if (dsn === currentDsn && module.getClient()) return;

  currentDsn = dsn;

  module.init({
    dsn,
    environment: environment ?? 'development',
    ...(release ? { release } : {}),
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent): ErrorEvent => ({
      ...event,
      request: undefined,
      user: undefined,
      extra: undefined,
      // keep only the contexts the tracker needs to interpret a media failure:
      // our allowlisted timelines plus the browser and OS versions. Everything
      // else can contain chat text, URLs or transport details.
      contexts: event.contexts
        ? {
            ...(event.contexts.browser
              ? { browser: event.contexts.browser }
              : {}),
            ...(event.contexts.os ? { os: event.contexts.os } : {}),
            ...(event.contexts.p2p ? { p2p: event.contexts.p2p } : {}),
            ...(event.contexts.network
              ? { network: event.contexts.network }
              : {})
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
// release. the dsn and the environment of the deployment are rendered into the
// html by the server, so the page reports before anyone signs in; a dsn that
// arrives later with the public settings used to re-open the client with the
// sdk default ('development') and without a release, which mislabels every
// browser event of a production deployment
const initAppSentry = (dsn?: string | null) => {
  // the typeof guard keeps the client tests running, where no server rendered
  // the global
  const deployment =
    typeof __DODECAGON_ERRORS__ === 'undefined'
      ? undefined
      : __DODECAGON_ERRORS__;

  // the sdk loads in its own chunk, a deployment without a dsn never pays for it
  return initSentry(
    dsn || deployment?.dsn,
    deployment?.environment ?? undefined,
    typeof VITE_APP_VERSION === 'undefined' ? undefined : VITE_APP_VERSION
  );
};

const captureError = (error: unknown, tags?: Record<string, string>) => {
  if (!enabled || !sentry) return;

  sentry.captureException(error, tags ? { tags } : undefined);
};

const captureDiagnostic = (event: TTrackerDiagnostic) => {
  if (!enabled || !sentry) return;

  sentry.captureEvent({
    level: event.level,
    message: event.message,
    tags: event.tags,
    contexts: event.contexts,
    fingerprint: event.fingerprint
  });
};

type TNetworkDiagnostic = {
  reachability: string;
  distinctPorts: number;
  answeredServers: number;
  servers: string[];
  usedFallback: boolean;
  gatherMs: number;
};

// a stun url is scheme:host:port, and an ipv6 host keeps its brackets
const stunHost = (url: string): string => {
  const withoutScheme = url.replace(/^stuns?:/i, '');
  const bracket = withoutScheme.indexOf(']');

  if (withoutScheme.startsWith('[') && bracket > 0) {
    return withoutScheme.slice(0, bracket + 1);
  }

  return withoutScheme.split(':')[0] ?? '';
};

// the tracker gets the verdict and the shape of the measurement, never the
// mapped addresses: an event that says the network is symmetric does not need
// to carry the public ip the same user connected from
const captureNetworkDiagnostic = (diagnostic: TNetworkDiagnostic): void => {
  captureDiagnostic({
    level: 'info',
    message: 'network.reachability',
    tags: {
      area: 'network',
      'network.reachability': diagnostic.reachability
    },
    contexts: {
      network: {
        reachability: diagnostic.reachability,
        distinct_ports: diagnostic.distinctPorts,
        answered_servers: diagnostic.answeredServers,
        servers: diagnostic.servers.map(stunHost),
        used_fallback: diagnostic.usedFallback,
        gather_ms: diagnostic.gatherMs
      }
    },
    fingerprint: ['network.reachability', diagnostic.reachability]
  });
};

export {
  captureDiagnostic,
  captureError,
  captureNetworkDiagnostic,
  initAppSentry,
  initSentry
};
