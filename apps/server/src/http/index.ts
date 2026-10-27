import { getErrorMessage, StartRequestHeaders } from '@dodecagon/shared';
import chalk from 'chalk';
import http from 'http';
import z from 'zod';
import { config } from '../config';
import { getWsInfo } from '../helpers/get-ws-info';
import { getStartHandler } from '../helpers/start-server';
import { logger } from '../logger';
import { pluginManager } from '../plugins';
import { SERVER_VERSION } from '../utils/env';
import { HttpValidationError, PayloadTooLargeError } from './errors';
import { healthRouteHandler } from './healthz';
import {
  applyCorsHeaders,
  getPublicOrigin,
  getRequestUrl,
  hasPrefixPathSegment,
  isSecureRequest,
  isSupportedHttpMethod,
  sendJsonError,
  sendJsonFieldErrors,
  type HttpRouteHandler,
  type TSupportedHttpMethod
} from './helpers';
import { infoRouteHandler } from './info';
import { interfaceRouteHandler } from './interface';
import { loginRouteHandler } from './login';
import { manifestRouteHandler } from './manifest';
import { oidcBackchannelLogoutRouteHandler } from './oidc/backchannel-logout';
import { oidcCallbackRouteHandler } from './oidc/callback';
import { oidcExchangeRouteHandler } from './oidc/exchange';
import { oidcLoginRouteHandler } from './oidc/login';
import { pluginBundleRouteHandler } from './plugin-bundle';
import { pluginRegistryRouteHandler } from './plugin-registry';
import { runPluginRoute } from './plugin-route';
import { pluginsComponentsRouteHandler } from './plugins-components';
import { publicRouteHandler } from './public';
import { uploadFileRouteHandler } from './upload';
import { sendWebResponse, toWebRequest } from './web-adapter';

// the paths the start server owns in a release. the bun handlers keep them in
// development, where the start bundle is never unpacked
const START_PATHS = new Set([
  '/',
  '/connect',
  '/app',
  '/disconnected',
  '/design-system',
  '/info',
  '/manifest.json',
  '/healthz',
  '/login',
  '/plugin-components',
  '/oidc/login',
  '/oidc/callback',
  '/oidc/exchange',
  '/oidc/backchannel-logout'
]);

// the server functions of the browser travel to the start server under their own
// prefix, the exact paths of the set do not cover them
const START_PATH_PREFIXES = ['/_serverFn'];

const isStartPath = (pathname: string) =>
  START_PATHS.has(pathname) ||
  START_PATH_PREFIXES.some((prefix) => hasPrefixPathSegment(pathname, prefix));

// parsed once per request and handed to every handler, so nothing below re-parses the url
// or re-resolves the client ip
type RouteContext = {
  info: ReturnType<typeof getWsInfo>;
  pathname: string;
  url: URL;
};

// plugin routes are registered with decoded paths, so decode per segment to keep
// an encoded '/' inside a segment from splitting into two
const getPluginRoute = (pathname: string) => {
  if (!hasPrefixPathSegment(pathname, '/plugins')) {
    return undefined;
  }

  const [, , pluginId, ...routePathSegments] = pathname.split('/');

  if (!pluginId) {
    return undefined;
  }

  try {
    return {
      pluginId: decodeURIComponent(pluginId),
      routePath: `/${routePathSegments
        .map((segment) => decodeURIComponent(segment))
        .join('/')}`
    };
  } catch {
    return undefined;
  }
};

const routeHandlers: Partial<
  Record<
    TSupportedHttpMethod,
    {
      exact: Record<string, HttpRouteHandler<RouteContext>>;
      prefix: Record<string, HttpRouteHandler<RouteContext>>;
    }
  >
> = {
  GET: {
    exact: {
      '/healthz': healthRouteHandler,
      '/info': infoRouteHandler,
      '/manifest.json': manifestRouteHandler,
      '/oidc/login': oidcLoginRouteHandler,
      '/oidc/callback': oidcCallbackRouteHandler,
      // exact match so it wins over the plugin route parser, which would read
      // `registry` as a plugin id
      '/plugins/registry': pluginRegistryRouteHandler
    },
    prefix: {
      '/public': publicRouteHandler,
      '/plugin-components': pluginsComponentsRouteHandler,
      '/plugin-bundle': pluginBundleRouteHandler
    }
  },
  POST: {
    exact: {
      '/upload': uploadFileRouteHandler,
      '/login': loginRouteHandler,
      '/oidc/exchange': oidcExchangeRouteHandler,
      '/oidc/backchannel-logout': oidcBackchannelLogoutRouteHandler
    },
    prefix: {}
  }
};

// this http server implementation is temporary and will be moved to bun server later when things are more stable
// an empty host keeps node's default of listening on every interface
const createHttpServer = async (
  port: number = config.server.port,
  host: string = config.server.host
) => {
  return new Promise<http.Server>((resolve) => {
    const server = http.createServer(
      async (req: http.IncomingMessage, res: http.ServerResponse) => {
        applyCorsHeaders(req, res);

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('X-Dodecagon-Version', SERVER_VERSION);

        const info = getWsInfo(undefined, req);
        const url = getRequestUrl(req);

        logger.debug(
          `${chalk.dim('[HTTP]')} ${req.method} ${url?.pathname} - ${info?.ip}`
        );

        if (!url) {
          sendJsonError(res, 400, 'Bad request');
          return;
        }

        const pathname = url.pathname;
        const ctx: RouteContext = { info, pathname, url };

        try {
          const method =
            req.method && isSupportedHttpMethod(req.method)
              ? req.method
              : undefined;

          // a release serves the interface and the api paths from the start
          // server, the bun handlers answer the same paths in development
          const startHandler =
            method && method !== 'OPTIONS' ? await getStartHandler() : null;

          if (startHandler && isStartPath(pathname)) {
            const request = toWebRequest(req, url, {
              // the dispatcher is the trust boundary, the start server cannot see
              // the socket and would have to trust the forwarded headers
              [StartRequestHeaders.CLIENT_IP]: info?.ip ?? '',
              [StartRequestHeaders.PUBLIC_ORIGIN]: getPublicOrigin(req),
              [StartRequestHeaders.SECURE]: String(isSecureRequest(req)),
              [StartRequestHeaders.MAX_BODY_BYTES]: String(
                config.server.maxRequestBodyBytes
              )
            });

            const response = await startHandler(request);

            await sendWebResponse(res, response);

            return res;
          }

          if (method) {
            const methodHandlers = routeHandlers[method];

            if (methodHandlers) {
              const exactHandler = methodHandlers.exact[pathname];

              if (exactHandler) {
                return await exactHandler(req, res, ctx);
              }

              for (const [prefix, prefixHandler] of Object.entries(
                methodHandlers.prefix
              )) {
                if (hasPrefixPathSegment(pathname, prefix)) {
                  return await prefixHandler(req, res, ctx);
                }
              }
            }

            const pluginRoute = getPluginRoute(pathname);

            if (pluginRoute) {
              const route = pluginManager.getHttpRoute(
                pluginRoute.pluginId,
                method,
                pluginRoute.routePath
              );

              if (route) {
                return await runPluginRoute(req, res, route);
              }

              if (method !== 'OPTIONS') {
                sendJsonError(res, 404, 'Not found');

                return;
              }
            }
          }

          if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();

            return;
          }

          // fallback to interface route handler for GET requests
          if (method === 'GET') {
            return await interfaceRouteHandler(req, res, ctx);
          }
        } catch (error) {
          // a handler that already started writing cannot be turned into an error
          // response, so drop the connection instead of throwing on writeHead
          if (res.headersSent) {
            logger.error(
              'HTTP route error after the response started: %s',
              getErrorMessage(error)
            );

            res.destroy();
            return;
          }

          const errorsMap: Record<string, string> = {};

          if (error instanceof PayloadTooLargeError) {
            sendJsonError(res, 413, error.message);
            return;
          }

          if (error instanceof z.ZodError) {
            for (const issue of error.issues) {
              const field = issue.path[0];

              if (typeof field === 'string') {
                errorsMap[field] = issue.message;
              }
            }

            sendJsonFieldErrors(res, 400, errorsMap);
            return;
          } else if (error instanceof HttpValidationError) {
            errorsMap[error.field] = error.message;

            sendJsonFieldErrors(res, 400, errorsMap);
            return;
          }

          logger.error('HTTP route error: %s', getErrorMessage(error));

          sendJsonError(res, 500, 'Internal server error');
          return;
        }

        sendJsonError(res, 404, 'Not found');
      }
    );

    server.on('listening', () => {
      logger.debug('HTTP server is listening on port %d', port);
      resolve(server);
    });

    server.on('close', () => {
      logger.debug('HTTP server closed');
    });

    server.listen(port, host || undefined);
  });
};

export { createHttpServer, isStartPath, START_PATHS };
