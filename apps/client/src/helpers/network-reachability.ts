// Two peers can only reach each other directly when their networks keep one
// public port per local socket. Every STUN server is asked from the same local
// socket, so the mapped ports they report describe that single mapping: the same
// port from every server is an endpoint independent (cone) mapping, a different
// port per server is the symmetric case, where a peer's inbound packets arrive
// on a port nobody negotiated and direct media cannot be established.

export type TNetworkReachability = 'open' | 'symmetric' | 'blocked' | 'unknown';

export type TMappedEndpoint = {
  address: string;
  port: number;
  /** the local port the mapping was made from, when the candidate reported it */
  basePort: number | null;
};

export type TNetworkVerdict = {
  reachability: TNetworkReachability;
  distinctPorts: number;
  answeredServers: number;
};

export type TNetworkVerdictTone = 'success' | 'warning' | 'danger' | 'muted';

const MAPPED_CANDIDATE_TYPES = ['srflx', 'prflx'];

const toPort = (value: string | undefined): number | null => {
  const port = Number(value);

  return Number.isInteger(port) && port > 0 ? port : null;
};

// one candidate line: a=candidate:<foundation> <component> <transport>
// <priority> <address> <port> typ <type> raddr <address> rport <port> ...
const parseCandidateLine = (line: string): TMappedEndpoint | null => {
  if (!line.startsWith('a=candidate:')) return null;

  const parts = line.slice('a=candidate:'.length).trim().split(/\s+/);
  const typeAt = parts.indexOf('typ');
  const type = typeAt < 0 ? undefined : parts[typeAt + 1];

  if (!type || !MAPPED_CANDIDATE_TYPES.includes(type)) return null;

  const address = parts[4];
  const port = toPort(parts[5]);

  if (!address || port === null) return null;

  // the server side of the pair is the local socket the mapping was made from
  const relatedAt = parts.indexOf('rport');

  return {
    address,
    port,
    basePort: relatedAt < 0 ? null : toPort(parts[relatedAt + 1])
  };
};

// a mapped endpoint repeats when two servers agree on it, and that agreement is
// exactly the evidence the classification needs, so the answers are kept
const parseMappedEndpoints = (sdp: string): TMappedEndpoint[] =>
  sdp
    .split(/\r?\n/)
    .map(parseCandidateLine)
    .filter((endpoint): endpoint is TMappedEndpoint => endpoint !== null);

const isIPv4 = (endpoint: TMappedEndpoint) => !endpoint.address.includes(':');

const describeNetwork = ({
  serverCount,
  mapped
}: {
  serverCount: number;
  mapped: TMappedEndpoint[];
}): TNetworkVerdict => {
  // a dual stack gather reports a second mapping per family, which says nothing
  // about how one socket is mapped, so the verdict reads the IPv4 path only
  const answers = mapped.filter(isIPv4);
  const distinctPorts = new Set(answers.map((endpoint) => endpoint.port)).size;

  if (answers.length === 0) {
    // an answer over IPv6 only says the v4 path is not the one in use, not that
    // nothing answered at all
    return {
      reachability: mapped.length === 0 ? 'blocked' : 'unknown',
      distinctPorts,
      answeredServers: 0
    };
  }

  // per local socket: several public ports mean the mapping depends on the
  // destination, whatever the other sockets did
  const portsPerSocket = new Map<number, Set<number>>();

  for (const answer of answers) {
    const socket = answer.basePort ?? 0;
    const ports = portsPerSocket.get(socket) ?? new Set<number>();

    ports.add(answer.port);
    portsPerSocket.set(socket, ports);
  }

  const drifts = [...portsPerSocket.values()].some((ports) => ports.size > 1);

  if (drifts) {
    return {
      reachability: 'symmetric',
      distinctPorts,
      answeredServers: answers.length
    };
  }

  // one stable port is only evidence of a cone mapping when two servers agreed
  if (serverCount >= 2 && answers.length >= 2) {
    return {
      reachability: 'open',
      distinctPorts,
      answeredServers: answers.length
    };
  }

  return {
    reachability: 'unknown',
    distinctPorts,
    answeredServers: answers.length
  };
};

const NETWORK_VERDICT: Record<
  TNetworkReachability,
  { tone: TNetworkVerdictTone; titleKey: string; descriptionKey: string }
> = {
  open: {
    tone: 'success',
    titleKey: 'networkOpenTitle',
    descriptionKey: 'networkOpenDesc'
  },
  symmetric: {
    tone: 'warning',
    titleKey: 'networkSymmetricTitle',
    descriptionKey: 'networkSymmetricDesc'
  },
  blocked: {
    tone: 'danger',
    titleKey: 'networkBlockedTitle',
    descriptionKey: 'networkBlockedDesc'
  },
  unknown: {
    tone: 'muted',
    titleKey: 'networkUnknownTitle',
    descriptionKey: 'networkUnknownDesc'
  }
};

const describeNetworkVerdict = (reachability: TNetworkReachability) =>
  NETWORK_VERDICT[reachability];

export { describeNetwork, describeNetworkVerdict, parseMappedEndpoints };
