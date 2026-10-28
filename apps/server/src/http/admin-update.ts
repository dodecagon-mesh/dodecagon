import {
  ActivityLogType,
  getErrorMessage,
  Permission
} from '@dodecagon/shared';
import type http from 'http';
import { config } from '../config';
import { userCan } from '../db/queries/roles';
import { getUserByToken } from '../db/queries/users';
import { getWsInfo } from '../helpers/get-ws-info';
import { zUpdateRequest } from '../helpers/update-request';
import { updater, UpdateRefusedError } from '../helpers/updater';
import { logger } from '../logger';
import { enqueueActivityLog } from '../queues/activity-log';
import { SERVER_VERSION } from '../utils/env';
import { createRateLimiter } from '../utils/rate-limiters/rate-limiter';
import {
  enforceHttpRateLimit,
  getJsonBody,
  getPublicOrigin,
  getRequestToken,
  isSecureRequest,
  sendJsonError
} from './helpers';

const updateRateLimiter = createRateLimiter({
  maxRequests: config.rateLimiters.adminUpdate.maxRequests,
  windowMs: config.rateLimiters.adminUpdate.windowMs
});

const UPDATE_BODY_LIMIT_BYTES = 1024;

const sendJson = (
  res: http.ServerResponse,
  statusCode: number,
  body: unknown
) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    // the state of an update is not a document anyone may cache or replay from a proxy
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
};

const isLoopbackSocket = (req: http.IncomingMessage): boolean => {
  const address = req.socket.remoteAddress;

  if (!address) return false;
  if (address === '::1') return true;

  return address === '::ffff:127.0.0.1' || address.startsWith('127.');
};

/**
 * A caller that is allowed to replace the binary the server runs, or undefined with the
 * response already written.
 */
const authenticateUpdateCaller = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  // the account token travels in the header of a tls request. a local caller is allowed
  // plain http, which is the documented way to reach the api over an ssh tunnel
  if (!isSecureRequest(req) && !isLoopbackSocket(req)) {
    sendJsonError(res, 403, 'The update api requires a secure connection.');

    return undefined;
  }

  // a page on another origin holds no token, but it must not be able to spend one that a
  // browser already has, and the dispatcher answers every path with permissive cors
  const origin = req.headers.origin;

  if (origin && origin !== getPublicOrigin(req)) {
    sendJsonError(res, 403, 'The origin of the request is not allowed.');

    return undefined;
  }

  const user = await getUserByToken(getRequestToken(req));

  if (!user) {
    sendJsonError(res, 401, 'Authentication required.');

    return undefined;
  }

  if (!(await userCan(user.id, Permission.MANAGE_UPDATES))) {
    sendJsonError(res, 403, 'Insufficient permissions');

    return undefined;
  }

  return user;
};

/** The request is refused by the limiter with its own response. */
const allowUpdateRequest = (
  req: http.IncomingMessage,
  res: http.ServerResponse
): boolean => {
  const allowed = enforceHttpRateLimit(
    res,
    updateRateLimiter,
    getWsInfo(undefined, req)?.ip,
    {
      route: '/admin/update',
      message: 'Too many update requests. Please try again shortly.'
    }
  );

  if (!allowed) req.resume();

  return allowed;
};

const adminUpdateStatusRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  if (!allowUpdateRequest(req, res)) return;

  const user = await authenticateUpdateCaller(req, res);

  if (!user) {
    req.resume();

    return;
  }

  sendJson(res, 200, {
    version: SERVER_VERSION,
    canUpdate: updater.canUpdate(),
    state: updater.getUpdateState()
  });

  req.resume();
};

/**
 * Asks the server to install a release. The install replaces this process, so the answer
 * leaves before the binary does and the outcome is read from the status route: a caller
 * that waited for the install itself would lose the connection mid-request.
 */
const adminUpdateRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  if (!allowUpdateRequest(req, res)) return;

  const user = await authenticateUpdateCaller(req, res);

  if (!user) {
    req.resume();

    return;
  }

  const parsed = zUpdateRequest.safeParse(
    await getJsonBody(req, UPDATE_BODY_LIMIT_BYTES)
  );

  if (!parsed.success) {
    sendJsonError(res, 400, 'Invalid update request.');

    return;
  }

  const request = parsed.data;

  if (!updater.canUpdate()) {
    sendJsonError(res, 501, 'Binary updates are not supported on this server.');

    return;
  }

  const currentState = updater.getUpdateState();

  if (currentState && currentState.phase !== 'failed') {
    sendJson(res, 409, {
      accepted: false,
      version: SERVER_VERSION,
      state: currentState
    });

    return;
  }

  // the actor is recorded before the install: the replaced process is the one that would
  // have written the entry otherwise
  enqueueActivityLog({
    type: ActivityLogType.SERVER_UPDATE_REQUESTED,
    userId: user.id,
    details: {
      fromVersion: SERVER_VERSION,
      targetVersion: request.targetVersion,
      allowDowngrade: request.allowDowngrade === true
    }
  });

  res.once('finish', () => {
    void updater.update(request).catch((error: unknown) => {
      if (error instanceof UpdateRefusedError) {
        logger.error('The server update was refused: %s', error.message);

        return;
      }

      logger.error('Failed to update server: %s', getErrorMessage(error));
    });
  });

  sendJson(res, 202, {
    accepted: true,
    version: SERVER_VERSION,
    targetVersion: request.targetVersion,
    allowDowngrade: request.allowDowngrade === true
  });
};

export { adminUpdateRouteHandler, adminUpdateStatusRouteHandler };
