import { getErrorMessage } from '@dodecagon/shared';
import { logVoice, logVoiceWarn } from './browser-logger';
import {
  describeNetwork,
  parseMappedEndpoints,
  type TMappedEndpoint,
  type TNetworkReachability
} from './network-reachability';
import { captureNetworkDiagnostic } from './sentry';

// telling a cone mapping from a symmetric one needs two servers that answer from
// different addresses, so a server that publishes fewer is topped up with these.
// they are only used when the deployment configured no usable list of its own
const FALLBACK_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
];

const GATHER_TIMEOUT_MS = 6000;

export type TNetworkStatus = {
  at: number;
  reachability: TNetworkReachability;
  distinctPorts: number;
  answeredServers: number;
  servers: string[];
  usedFallback: boolean;
  mapped: TMappedEndpoint[];
  gatherMs: number;
  error?: string;
};

const readStunServers = (configured: string[]) => {
  const stun = configured.filter((url) => /^stuns?:/i.test(url));

  if (stun.length >= 2) return { servers: stun, usedFallback: false };

  return { servers: FALLBACK_STUN_URLS, usedFallback: true };
};

const waitForGathering = (
  connection: RTCPeerConnection,
  timeoutMs: number
): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();

  if (connection.iceGatheringState === 'complete') {
    resolve();
    return promise;
  }

  const onChange = () => {
    if (connection.iceGatheringState !== 'complete') return;

    clearTimeout(timer);
    connection.removeEventListener('icegatheringstatechange', onChange);
    resolve();
  };

  // a server that never answers leaves the state at gathering, and the check
  // has to answer with what it has instead of hanging the settings page
  const timer = setTimeout(() => {
    connection.removeEventListener('icegatheringstatechange', onChange);
    resolve();
  }, timeoutMs);

  connection.addEventListener('icegatheringstatechange', onChange);

  return promise;
};

const gatherMappedEndpoints = async (servers: string[]) => {
  const started = Date.now();
  const connection = new RTCPeerConnection({
    iceServers: servers.map((url) => ({ urls: url })),
    bundlePolicy: 'max-bundle'
  });

  try {
    // one data channel is enough to make the browser gather candidates
    connection.createDataChannel('network-status');

    await connection.setLocalDescription(await connection.createOffer());
    await waitForGathering(connection, GATHER_TIMEOUT_MS);

    return {
      sdp: connection.localDescription?.sdp ?? '',
      gatherMs: Date.now() - started
    };
  } finally {
    connection.close();
  }
};

const probeNetworkStatus = async (
  configured: string[] = []
): Promise<TNetworkStatus> => {
  const { servers, usedFallback } = readStunServers(configured);
  const at = Date.now();

  if (typeof RTCPeerConnection === 'undefined') {
    return {
      at,
      servers,
      usedFallback,
      mapped: [],
      gatherMs: 0,
      reachability: 'unknown',
      distinctPorts: 0,
      answeredServers: 0,
      error: 'RTCPeerConnection is not available'
    };
  }

  try {
    const { sdp, gatherMs } = await gatherMappedEndpoints(servers);
    const mapped = parseMappedEndpoints(sdp);

    return {
      at,
      servers,
      usedFallback,
      mapped,
      gatherMs,
      ...describeNetwork({ serverCount: servers.length, mapped })
    };
  } catch (error) {
    return {
      at,
      servers,
      usedFallback,
      mapped: [],
      gatherMs: 0,
      reachability: 'unknown',
      distinctPorts: 0,
      answeredServers: 0,
      error: getErrorMessage(error)
    };
  }
};

// the log line is the copy that survives in renderer.log, so it carries the
// mapped addresses; the tracker gets the verdict and the counts without them
const reportNetworkStatus = (status: TNetworkStatus): void => {
  const detail = {
    reachability: status.reachability,
    mapped: status.mapped.map(({ address, port }) => `${address}:${port}`),
    distinctPorts: status.distinctPorts,
    answeredServers: status.answeredServers,
    servers: status.servers,
    usedFallback: status.usedFallback,
    gatherMs: status.gatherMs,
    at: new Date(status.at).toISOString(),
    ...(status.error ? { error: status.error } : {})
  };

  if (status.reachability === 'open') logVoice('network status', detail);
  else logVoiceWarn('network status', detail);

  if (status.error === 'RTCPeerConnection is not available') return;

  captureNetworkDiagnostic(status);
};

let cached: { key: string; status: Promise<TNetworkStatus> } | undefined;

// one check per page load: the answer describes the network, not the moment,
// and the settings page and the boot report share it. a different stun list is
// a different measurement, because the servers asked decide the verdict
const getNetworkStatus = (
  configured: string[] = [],
  options: { force?: boolean } = {}
): Promise<TNetworkStatus> => {
  const key = configured.join('|');

  if (options.force || cached?.key !== key) {
    cached = {
      key,
      status: probeNetworkStatus(configured).then((status) => {
        reportNetworkStatus(status);

        return status;
      })
    };
  }

  return cached.status;
};

const reportNetworkStatusOnBoot = (configured: string[] = []): void => {
  void getNetworkStatus(configured);
};

export { getNetworkStatus, reportNetworkStatusOnBoot };
