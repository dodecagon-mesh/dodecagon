import { getErrorMessage } from '@dodecagon/shared';
import http from 'http';
import { fetchMarketplaceRegistry } from '../helpers/marketplace';
import { logger } from '../logger';
import { sendJsonError } from './helpers';

// the browser asks this server instead of a third party host, so the registry
// host can be blocked or rotated without shipping a new client
const pluginRegistryRouteHandler = async (
  _req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  try {
    const entries = await fetchMarketplaceRegistry();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
  } catch (error) {
    logger.warn(
      `Failed to fetch the plugin marketplace registry: ${getErrorMessage(error)}`
    );

    sendJsonError(res, 502, 'Marketplace registry is unavailable');
  }

  return res;
};

export { pluginRegistryRouteHandler };
