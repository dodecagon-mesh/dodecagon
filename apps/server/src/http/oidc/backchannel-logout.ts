import type http from 'http';
import type { getWsInfo } from '../../helpers/get-ws-info';
import { verifyBackchannelLogoutService } from '../../helpers/services/oidc';
import {
  getPublicOrigin,
  getTextBody,
  isSecureRequest,
  sendServiceError
} from '../helpers';

// the service verifies the logout token and ends the sessions, this route only reads the
// form body and writes the answer
const oidcBackchannelLogoutRouteHandler = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { info }: { info: ReturnType<typeof getWsInfo> }
) => {
  const body = await getTextBody(req);
  const token = new URLSearchParams(body).get('logout_token') ?? '';

  const result = await verifyBackchannelLogoutService(token, {
    origin: getPublicOrigin(req),
    ip: info?.ip,
    secure: isSecureRequest(req),
    cookie: req.headers.cookie
  });

  if (!result.ok) {
    await sendServiceError(res, result.error);

    return;
  }

  res.writeHead(200, { 'Cache-Control': 'no-store' });
  res.end();
};

export { oidcBackchannelLogoutRouteHandler };
