import ipaddr from 'ipaddr.js';
import os from 'os';

const getPrivateIp = async () => {
  const interfaces = os.networkInterfaces();
  const addresses = Object.values(interfaces)
    .flat()
    .filter((iface) => iface?.family === 'IPv4' && !iface.internal)
    .map((iface) => iface?.address);

  return addresses[0];
};

// every lookup is a third party call on the boot path, so it must be bounded
const PUBLIC_IP_TIMEOUT_MS = 3000;

const fetchWithTimeout = async (url: string): Promise<Response> =>
  fetch(url, { signal: AbortSignal.timeout(PUBLIC_IP_TIMEOUT_MS) });

// providers answer either a bare address or a json body with an `ip` field, and
// the configured list decides which hosts get asked and in what order
const readPublicIp = async (url: string): Promise<string | undefined> => {
  try {
    const response = await fetchWithTimeout(url);
    const body = (await response.text()).trim();

    if (!body) return undefined;

    if (body.startsWith('{')) {
      const data = JSON.parse(body) as { ip?: unknown };

      return typeof data.ip === 'string' ? data.ip : undefined;
    }

    return body;
  } catch {
    return undefined;
  }
};

const getPublicIp = async (echoUrls: readonly string[]) => {
  for (const url of echoUrls) {
    const ip = await readPublicIp(url);

    if (ip) return ip;
  }

  // logger imports config, which imports this file, so console keeps the
  // boot path free of a circular import
  console.warn(
    'Could not determine the public IP address from any provider. Set webRtc.announcedAddress in config.ini if voice does not work.'
  );

  return undefined;
};

// the single answer to "is this a routable public address". an allowlist of one range
// rather than a blocklist, so anything ipaddr does not call unicast (carrierGradeNat,
// reserved, benchmarking and friends) is treated as not public. an unparseable address is
// not public either, which is what makes isPrivateIP below fail closed
const isPublicIp = (ip: string): boolean => {
  try {
    const parsed = ipaddr.parse(ip);

    if (parsed.kind() === 'ipv6') {
      const v6 = parsed as ipaddr.IPv6;

      if (v6.isIPv4MappedAddress())
        return v6.toIPv4Address().range() === 'unicast';
    }

    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
};

const isPrivateIP = (ip: string): boolean => !isPublicIp(ip);

export { getPrivateIp, getPublicIp, isPrivateIP, isPublicIp };
