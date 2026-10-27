import {
  getErrorMessage,
  parseMarketplaceRegistry,
  type TMarketplaceEntry,
  type TMarketplacePluginVersion
} from '@dodecagon/shared';
import { config } from '../config';
import { invariant } from '../utils/invariant';

const MARKETPLACE_FETCH_TIMEOUT_MS = 10_000;

// the browser never talks to the registry directly: the client asks this server,
// and the server walks the configured mirrors until one answers
const fetchMarketplaceRegistry = async (): Promise<TMarketplaceEntry[]> => {
  const failures: string[] = [];

  for (const url of config.endpoints.marketplaceRegistryUrls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }

      return parseMarketplaceRegistry(await response.json());
    } catch (error) {
      failures.push(`${url}: ${getErrorMessage(error)}`);
    }
  }

  invariant(
    failures.length === 0,
    `Failed to fetch marketplace registry (${failures.join('; ')})`
  );

  return [];
};

const fetchMarketplaceVersion = async (
  pluginId: string,
  version: string
): Promise<TMarketplacePluginVersion> => {
  const entries = await fetchMarketplaceRegistry();
  const entry = entries.find((e) => e.plugin.id === pluginId);

  invariant(entry, `Plugin '${pluginId}' not found in marketplace`);

  const versionData = entry.versions.find((v) => v.version === version);

  invariant(
    versionData,
    `Version '${version}' not found for plugin '${pluginId}'`
  );

  return versionData;
};

export { fetchMarketplaceRegistry, fetchMarketplaceVersion };
